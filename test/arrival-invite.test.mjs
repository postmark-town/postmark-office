// arrival-invite.test.mjs — "who invited you?" (POS-576), a public credit.
//
// Darko, 2026-10-11 09:53 and 2026-10-22 20:40: the join remembers
// `?invite=<handle>`; the settled household records who invited it, publicly;
// an invite naming your own household, a meep or an unknown handle records
// nothing, and the rest of the join is unchanged. Wright mints by hand.
//
// Every house, handle, login and id here is INVENTED.
//
//   I1  the name is normalised, and a blank is nothing
//   I2  a resident's handle credits their household; a household's slug credits it
//   I3  refused by name: your own household, the town's own, a meep, a stranger;
//       the meep law is the town's own ledger, read through its own tool
//   I4  the record: absent renders no key, present renders in template order
//   I5  the one writer writes only while NULL, and never throws
//   I6  the receipt says what happened in one sentence
//   I7  begin parks the name with the declaration, and a bad one refuses nothing
//   I8  THE REAL ROAD: declare-exec on a real store and a real clone lands the
//       credit in the declaration's own commit; a refused invite lands the join
//       with no credit
//
//   node --test test/arrival-invite.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  INVITE_FIELDS, INVITE_FIELD_NAMES, TOWN_HOUSE,
  inviteNamed, judgeInvite, recordInvite, inviteReceipt,
} from "../src/arrival-invite.mjs";
import { DECLARE_SCHEMA } from "../src/declare.mjs";
import { rowsFromRegistry, renderRegistry, HOUSEHOLD_KEYS, INVITED_BY_KEYS } from "../src/registry-rows.mjs";
import { setHouseholdInvitedBy } from "../src/registry-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { openOauthDb, mintBerth } from "../src/oauth.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { meepLawAtOffice } from "../src/fund-holder.mjs";
import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";

delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN_CLONE = join(ROOT, "town-clone");

const LANTERN = { login: "lr-gh", id: 9101 };
const QUILL = { login: "qh-gh", id: 9103 };
const REGISTRY = () => ({ schema_version: 1, note: "invented for POS-576", households: {
  "lantern-row": { name: "Lantern Row", accounts: [LANTERN], residents: ["wick", "ember-lamp"], since: "2026-08-01", declared_by: "fixture" },
  "quill-hall": { name: "Quill Hall", accounts: [QUILL], residents: ["quill"], since: "2026-08-03", declared_by: "fixture" },
  [TOWN_HOUSE]: { name: "the town", accounts: [{ login: "town-gh", id: 9100 }], residents: ["town-pen"], since: "2026-07-01", declared_by: "fixture" },
  // THE COLLISION (review of #751, B1; live as mari and moth): "moth" is a
  // resident of rookery-row AND the slug of another house.
  "rookery-row": { name: "Rookery Row", accounts: [{ login: "rr-gh", id: 9104 }], residents: ["moth"], since: "2026-08-04", declared_by: "fixture" },
  moth: { name: "Moth's House", accounts: [{ login: "mh-gh", id: 9105 }], residents: ["mothling"], since: "2026-08-05", declared_by: "fixture" },
} });
const PINS = () => ({
  wick: { login: LANTERN.login, id: LANTERN.id, pinned: "2026-08-01" },
  "ember-lamp": { login: LANTERN.login, id: LANTERN.id, pinned: "2026-08-01" },
  quill: { login: QUILL.login, id: QUILL.id, pinned: "2026-08-03" },
  "town-pen": { login: "town-gh", id: 9100, pinned: "2026-07-01" },
  moth: { login: "rr-gh", id: 9104, pinned: "2026-08-04" },
  mothling: { login: "mh-gh", id: 9105, pinned: "2026-08-05" },
});
const OWN = { slug: "new-hearth", handle: "kindling" };
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
const MEEPS = new Set(["ember-lamp"]);
const isMeep = (h) => MEEPS.has(h);
const judge = (invited_by, extra = {}) => judgeInvite({ invited_by }, { registry: REGISTRY(), own: OWN, isMeep, ...extra });

// ── I1–I3 the name, judged ──────────────────────────────────────────────────

test("I1 · the name is trimmed, loses one leading @ and its case; a blank or absent name is no invite at all", () => {
  assert.equal(inviteNamed({ invited_by: "  @Wick " }), "wick");
  assert.equal(inviteNamed({ invited_by: "" }), null);
  assert.equal(inviteNamed({ invited_by: "   " }), null);
  assert.equal(inviteNamed({}), null);
  assert.equal(judgeInvite({}, { registry: REGISTRY(), own: OWN }), null, "no invite: nothing to judge, nothing to say");
  assert.deepEqual(INVITE_FIELD_NAMES, ["invited_by"]);
  assert.ok("invited_by" in DECLARE_SCHEMA.properties, "the declaration takes it");
  assert.equal(DECLARE_SCHEMA.required.includes("invited_by"), false, "and it is optional");
  assert.match(INVITE_FIELDS.invited_by.description, /public credit/, "the form says it is public");
});

test("I2 · a resident's handle credits their HOUSEHOLD, and a household's own slug credits it", () => {
  assert.deepEqual(judge("wick"), { by: "lantern-row", named: "wick" });
  assert.deepEqual(judge("@Quill"), { by: "quill-hall", named: "quill" });
  assert.deepEqual(judge("lantern-row"), { by: "lantern-row", named: "lantern-row" }, "a bare slug no resident holds is the house");
  assert.deepEqual(judge("hh:quill-hall"), { by: "quill-hall", named: "hh:quill-hall" }, "hh:<slug> names a house");
});

test("I2b · THE COLLISION (B1): a bare name is a resident's handle first; hh:<slug> is the house", () => {
  assert.deepEqual(judge("moth"), { by: "rookery-row", named: "moth" }, "moth the resident, never Moth's House");
  assert.deepEqual(judge("hh:moth"), { by: "moth", named: "hh:moth" }, "the house, spelled so it cannot be the resident");
  assert.deepEqual(judge("mothling"), { by: "moth", named: "mothling" });
  assert.deepEqual(judge("hh:nobody-here"), { refused: "unknown", named: "hh:nobody-here" }, "hh: names only a house");
  assert.deepEqual(judge("hh:wick"), { refused: "unknown", named: "hh:wick" }, "a resident is never a house");
});

test("I3 · refused by name, crediting nobody: your own household, the town's own, a meep, a name the town does not know", () => {
  assert.deepEqual(judge("new-hearth"), { refused: "own", named: "new-hearth" }, "the house this join founds");
  assert.deepEqual(judge("kindling"), { refused: "own", named: "kindling" }, "its own first resident");
  assert.deepEqual(judge(TOWN_HOUSE), { refused: "town", named: TOWN_HOUSE });
  assert.deepEqual(judge("town-pen"), { refused: "town", named: "town-pen" }, "a resident of the town's own house");
  for (const reserved of ["postmaster", "office", "ferry"]) assert.equal(judge(reserved).refused, "town", reserved);
  assert.deepEqual(judge("ember-lamp"), { refused: "meep", named: "ember-lamp" }, "a meep, though its house is real");
  assert.deepEqual(judge("nobody-here"), { refused: "unknown", named: "nobody-here" });
  assert.deepEqual(judge("hh:new-hearth"), { refused: "own", named: "hh:new-hearth" }, "your own house, by its house key");
  assert.deepEqual(judge("hh:the-town"), { refused: "town", named: "hh:the-town" });
  for (const law of [undefined, null]) assert.deepEqual(judge("wick", { isMeep: law }), { refused: "law", named: "wick" },
    "THE LAW FAILS CLOSED: unread, nothing is credited");
  // A house already holding the founding slug (a join that names the house it is
  // about to found under another spelling) is still its own.
  assert.deepEqual(judgeInvite({ invited_by: "wick" }, { registry: REGISTRY(), own: { slug: "lantern-row", handle: "x" }, isMeep }),
    { refused: "own", named: "wick" });
});

test("I3b · the meep law is the town's own: read from its ledger through its own stamp-mint tool (the instrument declare-exec asks)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-invite-meeplaw-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyFileSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"), join(dir, "tools", "stamp-mint.mjs"));
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-07-25 · rules: stamps-v3 · meeps: ember-lamp · friendship: 5:5,10:10 · sig: invented\n");
  const lawOf = await meepLawAtOffice(dir);
  assert.equal(lawOf("ember-lamp"), true, "the law line names the meep");
  assert.equal(lawOf("wick"), false);
  assert.deepEqual(judgeInvite({ invited_by: "ember-lamp" }, { registry: REGISTRY(), own: OWN, isMeep: lawOf }), { refused: "meep", named: "ember-lamp" });
  assert.match(readFileSync(join(ROOT, "src", "declare-exec.mjs"), "utf8"), /isMeep = await meepLawAtOffice\(CLONE, \{ strict: true \}\)/, "and the exec judges with it, strictly");
  assert.equal((await meepLawAtOffice(dir, { strict: true }))("ember-lamp"), true, "strict reads the same law");

  // STRICT FAILS CLOSED: no tool, no ledger, or a ledger with no law line throws; the lenient read keeps its old answer.
  const bare = mkdtempSync(join(tmpdir(), "pm-invite-nolaw-"));
  dirs.push(bare);
  mkdirSync(join(bare, "tools"), { recursive: true });
  mkdirSync(join(bare, "WHITE_PAGES"), { recursive: true });
  await assert.rejects(meepLawAtOffice(bare, { strict: true }), /the meep law is unreadable: no WHITE_PAGES\/stamp-ledger\.md/);
  assert.equal((await meepLawAtOffice(bare))("ember-lamp"), false, "the fund page's lenient read is unchanged");
  copyFileSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"), join(bare, "tools", "stamp-mint.mjs"));
  writeFileSync(join(bare, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-07-01 · MINT → wick · 5 · for: welcome · sig: invented\n");
  await assert.rejects(meepLawAtOffice(bare, { strict: true }), /the meep law is unreadable: the ledger holds no law line/);
});

// ── I4 the record ───────────────────────────────────────────────────────────

test("I4 · invited_by is the tail column; absent renders no key, present renders in template order, and folds back", () => {
  assert.equal(HOUSEHOLD_KEYS.at(-1), "invited_by");
  const rows = rowsFromRegistry(REGISTRY(), PINS());
  assert.ok(rows.households.every((r) => r.invited_by === null), "no key folds to NULL");
  assert.equal(renderRegistry(rows).households.includes("invited_by"), false, "an uninvited registry prints exactly as before");
  // jsonb hands keys back sorted by (length, bytes); the render puts them back.
  rows.households[1].invited_by = { at: "2026-10-22T12:00:00.000Z", by: "lantern-row", named: "wick" };
  const printed = JSON.parse(renderRegistry(rows).households).households["quill-hall"];
  assert.deepEqual(Object.keys(printed.invited_by), [...INVITED_BY_KEYS]);
  assert.deepEqual(INVITED_BY_KEYS, ["by", "named", "at"]);
  assert.equal(Object.keys(printed).at(-1), "invited_by");
  assert.equal(rowsFromRegistry(JSON.parse(renderRegistry(rows).households), PINS()).households[1].invited_by.by, "lantern-row",
    "the printed credit folds back: the round trip holds");
});

// ── I5 the one writer ───────────────────────────────────────────────────────

async function withStub(fn) {
  const pool = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, RECORD_ON);
  try { return await fn(pool); }
  finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
const AT = new Date("2026-10-22T12:00:00.000Z");

test("I5 · recordInvite writes the credit once, only while the row holds none, and never throws", async () => {
  await withStub(async (pool) => {
    const done = await recordInvite({ slug: "quill-hall", judged: { by: "lantern-row", named: "wick" }, at: AT });
    assert.deepEqual(done, { kept: true, invited_by: { by: "lantern-row", named: "wick", at: AT.toISOString() } });
    const row = pool.state.households.find((r) => r.slug === "quill-hall");
    assert.deepEqual(row.invited_by, { by: "lantern-row", named: "wick", at: AT.toISOString() });
    const again = await recordInvite({ slug: "quill-hall", judged: { by: "someone-else", named: "x" }, at: AT });
    assert.equal(again.kept, false, "a credit records the arrival; a second write changes nothing");
    assert.equal(row.invited_by.by, "lantern-row");
    assert.deepEqual(await recordInvite({ slug: "quill-hall", judged: { refused: "meep", named: "ember-lamp" } }), { kept: false },
      "a refused invite writes nothing at all");
  });
  const logs = [];
  const thrown = await recordInvite({ slug: "quill-hall", judged: { by: "lantern-row", named: "wick" },
    write: async () => { throw new Error("permission denied for table households"); }, log: (l) => logs.push(l) });
  assert.deepEqual(thrown, { kept: false, why: "the store refused" });
  const unpointed = await recordInvite({ slug: "quill-hall", judged: { by: "lantern-row", named: "wick" }, write: async () => null, log: (l) => logs.push(l) });
  assert.deepEqual(unpointed, { kept: false, why: "no record" });
  assert.equal(logs.length, 2, "each miss is logged once");
  for (const l of logs) assert.match(l, /quill-hall: not kept \(by lantern-row, named wick, at \d{4}-\d\d-\d\dT[^)]+\)/,
    "B2: the line carries what a hand needs to write the credit again");
  assert.equal(typeof setHouseholdInvitedBy, "function");
});

// ── I6 the receipt ──────────────────────────────────────────────────────────

test("I6 · the receipt: one sentence, public when kept, the reason when refused, and the join always stands", () => {
  assert.equal(inviteReceipt(null), null);
  assert.equal(inviteReceipt({ by: "lantern-row", named: "wick" }, { kept: true }), "Recorded publicly: invited by lantern-row (wick).");
  assert.equal(inviteReceipt({ by: "lantern-row", named: "lantern-row" }, { kept: true }), "Recorded publicly: invited by lantern-row.");
  assert.match(inviteReceipt({ by: "lantern-row", named: "wick" }, { kept: false }), /could not be written.*Your join is unaffected/);
  assert.equal(inviteReceipt({ by: "moth", named: "hh:moth" }, { kept: true }), "Recorded publicly: invited by moth.");
  for (const [refused, words] of [["own", /your own household/], ["town", /town's own house/], ["meep", /meep/], ["unknown", /nobody the town knows/], ["law", /meep law is unreadable/]]) {
    const line = inviteReceipt({ refused, named: "x" });
    assert.match(line, words, refused);
    assert.match(line, /^Not recorded: "x" .*Your join is unaffected\.$/, refused);
  }
});

// ── I7 begin parks it ───────────────────────────────────────────────────────

test("I7 · begin parks the named inviter with the declaration (the co-sign runs it), and a stranger's name refuses nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-invite-begin-"));
  dirs.push(dir);
  const odb = openOauthDb(join(dir, "oauth.db"));
  await mintBerth(odb, "lantern-guest");
  const key = { berth: true, slug: "lantern-guest", household: null, handles: new Set() };
  const r = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "I came because a friend asked.", invited_by: " @Wick " } }, key, { odb });
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  assert.equal(r.result.invited_by.named, "wick", "the answer says what was parked");
  assert.match(r.result.invited_by.note, /publicly/);
  const parked = JSON.parse(odb.prepare("SELECT card FROM berths WHERE slug = 'lantern-guest'").get().card);
  assert.equal(parked.invited_by, "wick", "it rides the parked declaration, which the co-sign runs");
  const none = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "Again." } }, key, { odb });
  assert.ok(!none.error);
  assert.equal("invited_by" in JSON.parse(odb.prepare("SELECT card FROM berths WHERE slug = 'lantern-guest'").get().card), false,
    "begin again replaces the parked declaration whole");
  odb.close?.();
});

// ── I8 the real road ────────────────────────────────────────────────────────
//
// src/declare-exec.mjs spawned as declareViaOffice spawns it, against a real
// store (the embedded Postgres, every migration applied, 085 among them) and a
// real git clone (ashore.test.mjs's harness).

const IX = await indexStore(fixtureTown());
const IX_RESTORE = await IX.useInProcess();
const RECORD_RESTORE = await recordInProcess(IX.store);
test.after(async () => { await RECORD_RESTORE(); await IX_RESTORE(); await IX.stop(); });
await seedRegistry(IX.store, REGISTRY(), PINS());

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
// THE MEEP LAW, SEALED (P16's harness, pen-transaction.test.mjs): the town's own
// engine, a genesis line and one law line naming the meep, each signed under a
// key this test holds, so the declaration's house-key writer and the meep law
// read the same real ledger. `law: false` leaves the clone with no ledger.
const ENGINE = await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs")).href);
const LAW_KEYS = generateKeyPairSync("ed25519");
const KEY_DIR = mkdtempSync(join(tmpdir(), "pm-invite-key-"));
dirs.push(KEY_DIR);
const STAMP_KEY = join(KEY_DIR, "stamp-key.pem");
writeFileSync(STAMP_KEY, LAW_KEYS.privateKey.export({ type: "pkcs8", format: "pem" }));
function sealedLedger(lines) {
  const seals = ENGINE.sealChain(lines);
  return "# the stamp ledger\n\n" + lines.map((l, i) => `${l} · sig: ${sign(null, Buffer.from(seals[i], "utf8"), LAW_KEYS.privateKey).toString("base64url")}`).join("\n") + "\n";
}
function townClone({ law = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pm-invite-town-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  if (law) {
    copyFileSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"), join(dir, "tools", "stamp-mint.mjs"));
    writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), LAW_KEYS.publicKey.export({ type: "spki", format: "pem" }));
    mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), sealedLedger([
      "- 2026-06-12 · rules: stamps-v1",
      "- 2026-07-25 · rules: stamps-v3 · meeps: ember-lamp · friendship: 5:5,10:10",
    ]));
  }
  for (const h of ["wick", "ember-lamp", "quill", "town-pen", "moth", "mothling"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(REGISTRY()));
  writeFileSync(join(dir, PINS_PATH), serializePins(PINS()));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}
const clone = townClone();
const lawless = townClone({ law: false });

function declareExec(args, key, { at = clone } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "src", "declare-exec.mjs"), JSON.stringify({ args, key })], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: at, TOWN_PUSH: "", BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid",
      STAMP_KEY, STAMP_ENGINE_DIR: join(TOWN_CLONE, "tools") },
  });
  assert.equal(r.status, 0, `declare-exec answers rather than trips: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}
async function rowOf(slug) {
  const c = await IX.store.connect("office_api");
  try { return (await c.query("SELECT invited_by FROM households WHERE slug = $1", [slug])).rows[0] ?? null; }
  finally { await c.end(); }
}
const housesIn = (commit) => JSON.parse(git(clone, "show", `${commit}:${REGISTRY_PATH}`)).households;

test("I8a · an invited join lands the credit on its row AND in its own commit's tools/households.json", async () => {
  const out = declareExec({ handle: "kindling", household: "New Hearth", card: "I keep a small fire going.", invited_by: "@Wick" },
    { ghId: 5150, ghLogin: "hearth-gh", handles: [] });
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(out.invite, "Recorded publicly: invited by lantern-row (wick).");
  const row = await rowOf("new-hearth");
  assert.equal(row.invited_by.by, "lantern-row");
  assert.equal(row.invited_by.named, "wick");
  assert.ok(!Number.isNaN(Date.parse(row.invited_by.at)), "with the instant of the declaration");
  const printed = housesIn(out.commit)["new-hearth"];
  assert.ok(printed, "the house is in its own commit's registry");
  assert.deepEqual(printed.invited_by, row.invited_by, "and so is the credit: the public record, in the same commit");
  assert.equal("invited_by" in housesIn(out.commit)["lantern-row"], false, "the inviter's own row is untouched");

  // 085 on the real store: the one writer writes only while NULL, and the
  // column's CHECK refuses a house credited to itself.
  assert.deepEqual(await setHouseholdInvitedBy({ slug: "new-hearth", invitedBy: { by: "quill-hall", named: "quill", at: AT.toISOString() } }),
    { slug: null }, "a credit is never rewritten");
  assert.equal((await rowOf("new-hearth")).invited_by.by, "lantern-row");
  await assert.rejects(setHouseholdInvitedBy({ slug: "quill-hall", invitedBy: { by: "quill-hall", named: "quill", at: AT.toISOString() } }),
    /households_invited_by_shape/, "the store refuses a self-credit by its own constraint");
});

test("I8c · THE COLLISION ON THE REAL ROAD (B1): ?invite=moth credits the resident's house; hh:moth credits the house", async () => {
  const resident = declareExec({ handle: "lamplight", household: "Lamplight Rooms", card: "Moth sent me.", invited_by: "moth" },
    { ghId: 5160, ghLogin: "lamp-gh", handles: [] });
  assert.equal(resident.error, undefined, JSON.stringify(resident.error));
  assert.equal(resident.invite, "Recorded publicly: invited by rookery-row (moth).");
  assert.equal((await rowOf("lamplight-rooms")).invited_by.by, "rookery-row");
  const house = declareExec({ handle: "candlewick", household: "Candlewick Den", card: "The house sent me.", invited_by: "hh:moth" },
    { ghId: 5161, ghLogin: "candle-gh", handles: [] });
  assert.equal(house.error, undefined, JSON.stringify(house.error));
  assert.equal(house.invite, "Recorded publicly: invited by moth.");
  assert.equal((await rowOf("candlewick-den")).invited_by.by, "moth");
});

test("I8d · the meep law on the real road: the sealed ledger's meep is refused; a clone with no law credits NOBODY (fails closed)", async () => {
  const meep = declareExec({ handle: "taper", household: "Taper House", card: "Lit from another's flame.", invited_by: "ember-lamp" },
    { ghId: 5162, ghLogin: "taper-gh", handles: [] });
  assert.equal(meep.error, undefined, JSON.stringify(meep.error));
  assert.match(meep.invite, /^Not recorded: "ember-lamp" names a meep/);
  assert.equal((await rowOf("taper-house")).invited_by, null);
  const blind = declareExec({ handle: "dusk", household: "Dusk House", card: "Wick sent me.", invited_by: "wick" },
    { ghId: 5163, ghLogin: "dusk-gh", handles: [] }, { at: lawless });
  assert.equal(blind.error, undefined, JSON.stringify(blind.error));
  assert.match(blind.invite, /^Not recorded: "wick" could not be judged: the town's meep law is unreadable/);
  assert.equal((await rowOf("dusk-house")).invited_by, null, "an unread law credits nobody, and the join still landed");
});

test("I8b · a refused invite lands the join with no credit and says why; no invite, no line", async () => {
  const own = declareExec({ handle: "ember", household: "Ember House", card: "Lit from my own flame.", invited_by: "hh:ember-house" },
    { ghId: 5151, ghLogin: "ember-gh", handles: [] });
  assert.equal(own.error, undefined, JSON.stringify(own.error));
  assert.match(own.invite, /^Not recorded: "hh:ember-house" names your own household/);
  assert.equal((await rowOf("ember-house")).invited_by, null);
  assert.equal("invited_by" in housesIn(own.commit)["ember-house"], false, "nothing printed");

  const stranger = declareExec({ handle: "wanderer", household: "Wander Inn", card: "Passing through.", invited_by: "nobody-here" },
    { ghId: 5152, ghLogin: "wander-gh", handles: [] });
  assert.equal(stranger.error, undefined);
  assert.match(stranger.invite, /names nobody the town knows/);
  assert.equal((await rowOf("wander-inn")).invited_by, null);

  const plain = declareExec({ handle: "solo", household: "Solo House", card: "Nobody sent me." }, { ghId: 5153, ghLogin: "solo-gh", handles: [] });
  assert.equal(plain.error, undefined);
  assert.equal("invite" in plain, false, "no invite, no line");
  assert.equal((await rowOf("solo-house")).invited_by, null);
});

// ── I9 Wright's read ────────────────────────────────────────────────────────

test("I9 · the read groups invited households by the sweep that closes their window, and names the inviter as it is called now", async () => {
  const { windowOf, planInvites, printInvites, currentSlugOf } = await import("../tools/invites.mjs");
  assert.equal(windowOf("2026-10-22T05:59:59.000Z"), "2026-10-22T06:00:00.000Z");
  assert.equal(windowOf("2026-10-22T06:00:00.000Z"), "2026-10-22T06:00:00.000Z", "a sweep's own instant is in its window");
  assert.equal(windowOf("2026-10-22T06:00:01.000Z"), "2026-10-22T18:00:00.000Z");
  assert.equal(windowOf("2026-10-22T23:00:00.000Z"), "2026-10-23T06:00:00.000Z", "after the evening sweep: the next morning's");
  const row = (slug, by, at, named = by) => ({ slug, name: slug, residents: [`${slug}-r`], invited_by: { by, named, at } });
  const rows = [
    row("b-house", "lantern-row", "2026-10-22T07:00:00.000Z", "wick"),
    row("a-house", "old-lantern", "2026-10-22T01:00:00.000Z"),
    { slug: "plain", residents: ["p"], invited_by: null },
  ];
  // THE INVITER RENAMED: lantern-row was old-lantern when a-house named it
  const current = currentSlugOf([{ slug: "lantern-row", formerly: ["old-lantern"] }, { slug: "quill-hall", formerly: [] }]);
  assert.equal(current("old-lantern"), "lantern-row");
  assert.equal(current("quill-hall"), "quill-hall");
  assert.equal(current("gone-house"), "gone-house", "a name the registry never held stays as written");
  const plan = planInvites(rows, { current, ashore: new Map([["b-house-r", "2026-10-22T07:00:05.000Z"]]), rolled: new Set(["a-house-r"]) });
  assert.deepEqual(plan.map((p) => [p.household, p.window, p.invited_by, p.invited_by_was ?? null]), [
    ["a-house", "2026-10-22T06:00:00.000Z", "lantern-row", "old-lantern"],
    ["b-house", "2026-10-22T18:00:00.000Z", "lantern-row", null],
  ], "every invited household, not the plain one, under the inviter's name now");
  // SETTLED is the invitee's own 10: the store's ashore record, else an address in the roll
  assert.deepEqual(plan[0].settled, { yes: true, at: null, by: "an address in the town's roll" });
  assert.deepEqual(plan[1].settled, { yes: true, at: "2026-10-22T07:00:05.000Z", by: "the store's ashore record" });
  assert.deepEqual(planInvites([row("c-house", "quill-hall", "2026-10-22T09:00:00.000Z")])[0].settled, { yes: false });
  const printed = printInvites(plan);
  assert.match(printed, /a-house "a-house" · invited by lantern-row \(credited as old-lantern, renamed since\)/);
  assert.match(printed, /b-house "b-house" · invited by lantern-row \(named wick\)/);
  assert.match(printed, /SETTLED 2026-10-22T07:00:05\.000Z \(the store's ashore record\): the invitee's 10 is due/);
  assert.match(printInvites(planInvites([row("c-house", "quill-hall", "2026-10-22T09:00:00.000Z")])), /NOT SETTLED .*: the invitee's 10 waits/);
  assert.deepEqual(planInvites(rows, { current }, { since: "2026-10-22T02:00:00.000Z" }).map((p) => p.household), ["b-house"], "--since lists only the newer ones");
  assert.match(printInvites([]), /no household has joined with an invitation/);
});

test("I9c · the 30-day check (Wright's G5), and THE CAP COUNTS REAL INVITES ONLY, in the month each 10 falls due on Darko's clock", async () => {
  const { realOf, planInvites, printInvites, monthET } = await import("../tools/invites.mjs");
  const at = "2026-10-01T12:00:00.000Z";
  const now = new Date("2026-10-20T00:00:00.000Z");
  assert.deepEqual(realOf({ at, letter: "2026-10-05T00:00:00.000Z", home: "2026-10-03T00:00:00.000Z", now }),
    { first_letter: "2026-10-05T00:00:00.000Z", first_home: "2026-10-03T00:00:00.000Z", by: "2026-10-31T12:00:00.000Z", status: "real", at: "2026-10-03T00:00:00.000Z" },
    "the earlier of the two decides");
  assert.equal(realOf({ at, letter: "2026-10-31T12:00:00.000Z", now }).status, "real", "the 30th day's own instant is within");
  assert.equal(realOf({ at, letter: "2026-10-31T12:00:01.000Z", now }).status, "late");
  assert.equal(realOf({ at, now }).status, "waiting", "neither yet, the 30 days still running");
  assert.equal(realOf({ at, now: new Date("2026-11-01T00:00:00.000Z") }).status, "lapsed");
  // US-EASTERN: 2026-11-01T03:00Z is still October 31 in New York
  assert.equal(monthET("2026-11-01T03:00:00.000Z"), "2026-10");
  assert.equal(monthET("2026-11-01T05:00:00.000Z"), "2026-11");
  // twelve invited by quill-hall: eleven become real in October (ET), one never does
  const rows = Array.from({ length: 12 }, (_, i) => ({ slug: `h${String(i).padStart(2, "0")}`, residents: [`r${i}`],
    invited_by: { by: "quill-hall", named: "quill", at: `2026-10-0${1 + (i % 9)}T12:00:00.000Z` } }));
  const letters = new Map(rows.slice(0, 11).map((r, i) => [r.slug, `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00.000Z`]));
  letters.set("h10", "2026-11-01T03:00:00.000Z"); // the eleventh real one: October 31 in New York
  const plan = planInvites(rows, { letters }, { now });
  const never = plan.find((p) => p.household === "h11");
  assert.equal(never.real.status, "waiting");
  assert.equal(never.paid, null, "an invite that is not real takes no place in the cap");
  const paid = plan.filter((p) => p.paid).sort((a, b) => a.paid.nth - b.paid.nth);
  assert.deepEqual(paid.map((p) => p.paid.nth), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(paid.every((p) => p.paid.month === "2026-10"), "all eleven fall due in October, ET");
  assert.equal(paid.at(-1).household, "h10");
  assert.equal(paid.at(-1).paid.over_cap, true, "the eleventh REAL one is over the cap");
  assert.ok(paid.slice(0, 10).every((p) => !p.paid.over_cap));
  const printed = printInvites(plan);
  assert.match(printed, /h10 "?.*REAL: the inviter's 10 is owed, quill-hall's paid invite 11 in 2026-10 \(ET\), OVER the 10-a-month cap: not owed/s);
  assert.match(printed, /first letter 2026-10-10T12:00:00\.000Z · first home none · REAL: the inviter's 10 is owed, quill-hall's paid invite 1 in 2026-10 \(ET\)\n/);
});

test("I9b · the read, run as Wright runs it, on the real store: it lists the households I8a and I8c invited and nothing it didn't", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "invites.mjs"), "--json"], { encoding: "utf8", env: { ...process.env, ...IX.env } });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.deepEqual(plan.map((p) => [p.household, p.invited_by, p.named, p.first_resident]), [
    ["new-hearth", "lantern-row", "wick", "kindling"], ["lamplight-rooms", "rookery-row", "moth", "lamplight"], ["candlewick-den", "moth", "hh:moth", "candlewick"]]);
  assert.equal(plan[0].settled.yes, true);
  assert.match(plan[0].settled.at ?? "", /^\d{4}-\d\d-\d\dT/, "and when it came ashore, by the store's own record");
  assert.equal(plan[0].real.status, "waiting", "no letter and no home yet");
});

test("I9d · the read's 30-day facts come from the store: a delivered letter by any resident, and a parcel locked in the house's name", async () => {
  const at = (await rowOf("new-hearth")).invited_by.at;
  const soon = new Date(Date.parse(at) + 3 * 864e5).toISOString();
  const later = new Date(Date.parse(at) + 5 * 864e5).toISOString();
  const c = await IX.store.connect("world2_owner");
  try {
    await c.query("INSERT INTO town_letters (id, from_h, to_h, date, box, json, delivered_at, digest) VALUES ($1, $2, $3, $4, 'outbox', '{}', $5, 'd')",
      ["letter-invite-1", "kindling", "wick", later.slice(0, 10), later]);
    await c.query("INSERT INTO town_letters (id, from_h, to_h, date, box, json, delivered_at, digest) VALUES ($1, $2, $3, $4, 'outbox', '{}', NULL, 'd')",
      ["letter-invite-2", "kindling", "wick", soon.slice(0, 10)]);
    await c.query("INSERT INTO windows (id, opens_at, closes_at) VALUES (9901, $1, $2) ON CONFLICT DO NOTHING", [at, soon]);
    await c.query(`INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, locked_window)
      VALUES (gen_random_uuid(), 'kindling/hearth-ground', 'parcel', 'kindling', 'hh:new-hearth', '{}', box(point(9000,9000), point(9010,9010)), 9901)`);
  } finally { await c.end(); }
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "invites.mjs"), "--json"], { encoding: "utf8", env: { ...process.env, ...IX.env } });
  assert.equal(r.status, 0, r.stderr);
  const [p] = JSON.parse(r.stdout);
  assert.equal(p.real.first_letter, later, "the delivered letter counts; the undelivered one does not");
  assert.equal(p.real.first_home, soon, "the parcel's home is the close of the window that locked it");
  assert.equal(p.real.at, soon, "the earlier of the two");
  assert.equal(p.real.status, "real");
});
