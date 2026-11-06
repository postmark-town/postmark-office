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
  // THE FOUNDERS' HOUSE (POS-576/e): its real slug, because the rule names it.
  starforge: { name: "Starforge", accounts: [{ login: "sf-gh", id: 9106 }], residents: ["wright"], since: "2026-07-01", declared_by: "fixture" },
} });
const PINS = () => ({
  wick: { login: LANTERN.login, id: LANTERN.id, pinned: "2026-08-01" },
  "ember-lamp": { login: LANTERN.login, id: LANTERN.id, pinned: "2026-08-01" },
  quill: { login: QUILL.login, id: QUILL.id, pinned: "2026-08-03" },
  "town-pen": { login: "town-gh", id: 9100, pinned: "2026-07-01" },
  moth: { login: "rr-gh", id: 9104, pinned: "2026-08-04" },
  mothling: { login: "mh-gh", id: 9105, pinned: "2026-08-05" },
  wright: { login: "sf-gh", id: 9106, pinned: "2026-07-01" },
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
  // THE JOIN TEXT, AS RULED (POS-816/c, Darko 2026-11-03 09:31 EDT: "B"), whole. Until 2026-11-03 this
  // asserted the founders' clause (POS-576/e: "the founders' household (it never earns invitation stamps)")
  // and the old promise "they get 10 when you write your first letter or claim your home parcel within 30
  // days", which names no week and no hold.
  assert.equal(INVITE_FIELDS.invited_by.description,
    "Optional: the handle of the resident who invited you, or hh:<slug> for a household (an invitation link fills it in). This is a public credit: it shows on your household's record. You get 10 stamps instead of 5 when your household settles. Theirs gets 10 a week after your first letter or home (within 30 days), unless the town holds it for review. Your own household, the town's own household, a meep or a name the town doesn't know records nothing, and your join goes through either way.");
  assert.doesNotMatch(INVITE_FIELDS.invited_by.description, /founders|home parcel|always with a reason/, "no founders' clause (POS-816/d), none of the old promise, none of option A's words");
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
  assert.deepEqual(judge(TOWN_HOUSE), { refused: "town", named: TOWN_HOUSE }, "the town's own house; until 2026-11-03 this read \"founders\" (POS-576/e), a word the founders' household no longer shares (POS-816/d)");
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

test("I3c · THE FOUNDERS PAY LIKE ANY OTHER (POS-816/d): ?invite=wright credits starforge as ?invite=wick credits lantern-row; a meep of that house, and the town's own, are still refused", async () => {
  // Until 2026-11-03 this asserted POS-576/e ("No, never", Darko 2026-10-22 22:07): ?invite=wright resolved into
  // starforge and was refused as "founders", logged like a miss, nothing written. Darko 2026-11-03 09:31 EDT:
  // "this should pay like any other under the new NOMOS".
  const judged = judge("wright");
  assert.deepEqual(judged, { by: "starforge", named: "wright" });
  assert.deepEqual(judge("hh:starforge"), { by: "starforge", named: "hh:starforge" });
  assert.deepEqual(judge("starforge"), { by: "starforge", named: "starforge" }, "a bare slug no resident holds is the house");
  assert.equal(inviteReceipt(judged, { kept: true }), "Recorded publicly: invited by starforge (wright).");
  // the credit is written, as for any house, and nothing is logged as a miss
  const writes = [];
  const out = await recordInvite({ slug: "new-hearth", judged, at: AT, write: async (w) => { writes.push(w); return { slug: "new-hearth" }; }, log: () => assert.fail("a founders' credit is no miss") });
  assert.equal(out.kept, true);
  assert.deepEqual(writes, [{ slug: "new-hearth", invitedBy: { by: "starforge", named: "wright", at: AT.toISOString() } }]);
  // MEEPS STAY OUT (POS-655): the Starforge household lists meeps, and naming one by handle is refused, with the meep line
  const wide = { ...REGISTRY(), households: { ...REGISTRY().households, starforge: { ...REGISTRY().households.starforge, residents: ["wright", "architect"] } } };
  const meep = judgeInvite({ invited_by: "architect" }, { registry: wide, own: OWN, isMeep: (h) => h === "architect" });
  assert.deepEqual(meep, { refused: "meep", named: "architect" });
  assert.equal(inviteReceipt(meep), "\"architect\" is one of the town's meeps, so this invitation doesn't earn stamps: you get the standard 5. Your join is unaffected.");
  // the town's own house still earns nothing; NEVER A `by` (the follow-up review of #751): `by` is what a credit pays
  for (const n of ["the-town", "hh:the-town", "town-pen"]) {
    assert.equal(judge(n).refused, "town", n);
    assert.equal("by" in judge(n), false, n);
    assert.match(inviteReceipt(judge(n)), /^Not recorded: ".*" names the town's own house, which is not credited for invitations\. Your join is unaffected\.$/, n);
  }
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
  // the last column it joined; 091's human_profile (POS-721) came after it
  assert.deepEqual(HOUSEHOLD_KEYS.slice(-2), ["invited_by", "human_profile"]);
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
  for (const [refused, words] of [["own", /your own household/], ["town", /town's own house/], ["unknown", /nobody the town knows/], ["law", /meep law is unreadable/]]) {
    const line = inviteReceipt({ refused, named: "x" });
    assert.match(line, words, refused);
    assert.match(line, /^Not recorded: "x" .*Your join is unaffected\.$/, refused);
  }
  // THE MEEP LINE (POS-816/d, Darko 2026-11-03 09:31 EDT; the founders' option A, in the meeps' words). Until
  // 2026-11-03 this was `Not recorded: "x" names a meep, and meeps can't be credited for invitations. ...`
  assert.equal(inviteReceipt({ refused: "meep", named: "x" }),
    "\"x\" is one of the town's meeps, so this invitation doesn't earn stamps: you get the standard 5. Your join is unaffected.");
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
  // Until 2026-11-03 this asserted the note named "the founders' household (it never earns invitation stamps)" (POS-576/e);
  // the founders pay like any other now (POS-816/d), so the note must not tell a newcomer the opposite.
  assert.match(r.result.invited_by.note, /unless it names your own household, the town's own household, a meep or nobody the town knows/);
  assert.doesNotMatch(r.result.invited_by.note, /founders/);
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
  for (const h of ["wick", "ember-lamp", "quill", "town-pen", "moth", "mothling", "wright"]) {
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
  assert.equal(meep.invite, "\"ember-lamp\" is one of the town's meeps, so this invitation doesn't earn stamps: you get the standard 5. Your join is unaffected.",
    "the meep line (POS-816/d); until 2026-11-03 this was `Not recorded: \"ember-lamp\" names a meep, ...`");
  assert.equal((await rowOf("taper-house")).invited_by, null);
  const blind = declareExec({ handle: "dusk", household: "Dusk House", card: "Wick sent me.", invited_by: "wick" },
    { ghId: 5163, ghLogin: "dusk-gh", handles: [] }, { at: lawless });
  assert.equal(blind.error, undefined, JSON.stringify(blind.error));
  assert.match(blind.invite, /^Not recorded: "wick" could not be judged: the town's meep law is unreadable/);
  assert.equal((await rowOf("dusk-house")).invited_by, null, "an unread law credits nobody, and the join still landed");
});

test("I8e · THE FOUNDERS ON THE REAL ROAD (POS-816/d): ?invite=wright lands the join AND the credit, like any other house", async () => {
  // Until 2026-11-03 this asserted POS-576/e: the join landed with no credit, the reason "names the founders'
  // household, which never earns invitation stamps", and a log line "the founders never earn invitation stamps".
  const r = spawnSync(process.execPath, [join(ROOT, "src", "declare-exec.mjs"), JSON.stringify({
    args: { handle: "foundling-guest", household: "Guest Of The Founders", card: "Wright sent me.", invited_by: "wright" },
    key: { ghId: 5164, ghLogin: "guest-gh", handles: [] } })], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: clone, TOWN_PUSH: "", BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid",
      STAMP_KEY, STAMP_ENGINE_DIR: join(TOWN_CLONE, "tools") },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  assert.equal(out.settled, true, "the invitee settles as anyone does");
  assert.equal(out.invite, "Recorded publicly: invited by starforge (wright).");
  const row = await rowOf("guest-of-the-founders");
  assert.equal(row.invited_by.by, "starforge", "the credit is on the row: the pass has something to pay both sides from");
  assert.equal(row.invited_by.named, "wright");
  assert.deepEqual(housesIn(out.commit)["guest-of-the-founders"].invited_by, row.invited_by, "and in the same commit, the public record");
  assert.doesNotMatch(r.stderr, /guest-of-the-founders: not kept/, "and no miss is logged for it");
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

// THE READ IS THE PASS'S PLAN NOW (POS-816, Darko 2026-10-28 and 2026-11-03):
// tools/invites.mjs prints src/invite-pay.mjs § planInvitePay, the plan
// deploy/invite-pass.mjs pays from, read against the town's ledger. Until
// 2026-11-03 these tests pinned the hand-mint list (a window per sweep, "the
// invitee's 10 is due" on an ashore record, the cap counted in the month each
// inviter's 10 fell due by becoming real, the eleventh "not owed"). The rows,
// the rename, the 30 days and the founders keep their tests below; the cap's
// month is Darko's "Month paid" (POS-816/b).
const EMPTY_LEDGER = () => ({ welcomes: new Map(), invitedPaid: new Map(), inviterPaid: new Map(), paidInMonth: new Map() });

test("I9 · the read lists every invitation oldest first, names the inviter as it is called now, and reads each side off the ledger", async () => {
  const { windowOf, readInvites, printInvites, currentSlugOf } = await import("../tools/invites.mjs");
  assert.equal(windowOf("2026-10-22T05:59:59.000Z"), "2026-10-22T06:00:00.000Z");
  assert.equal(windowOf("2026-10-22T06:00:00.000Z"), "2026-10-22T06:00:00.000Z", "a sweep's own instant is in its window");
  assert.equal(windowOf("2026-10-22T06:00:01.000Z"), "2026-10-22T18:00:00.000Z");
  assert.equal(windowOf("2026-10-22T23:00:00.000Z"), "2026-10-23T06:00:00.000Z", "after the evening sweep: the next morning's");
  const row = (slug, by, at, named = by) => ({ slug, name: slug, residents: [`${slug}-r`], invited_by: { by, named, at } });
  const rows = [
    row("b-house", "lantern-row", "2026-10-22T07:00:00.000Z", "wick"),
    row("a-house", "old-lantern", "2026-10-22T01:00:00.000Z"),
  ];
  // THE INVITER RENAMED: lantern-row was old-lantern when a-house named it
  const houses = [{ slug: "lantern-row", residents: ["wick"], formerly: ["old-lantern"] }, { slug: "quill-hall", residents: ["quill"], formerly: [] }];
  const current = currentSlugOf(houses);
  assert.equal(current("old-lantern"), "lantern-row");
  assert.equal(current("gone-house"), "gone-house", "a name the registry never held stays as written");
  const ledger = EMPTY_LEDGER();
  ledger.welcomes.set("b-house", { handle: "b-house-r", key: "hh:b-house", date: "2026-10-22" });
  const store = { rows, houses, facts: { ashore: new Map([["b-house", "2026-10-22T07:00:05.000Z"]]) }, holds: new Map() };
  const read = readInvites(store, { ledger, now: new Date("2026-10-23T00:00:00.000Z") });
  assert.deepEqual(read.invitations.map((p) => [p.household, p.invited_by, p.invited_by_was ?? null, p.invited_side.status]), [
    ["a-house", "lantern-row", "old-lantern", "waiting"],
    ["b-house", "lantern-row", null, "owed"],
  ], "every invitation under the inviter's name now; the 5 more is owed once its welcome is on the ledger");
  assert.equal(read.invitations[1].invited_side.to, "b-house-r", "to the welcome's own recipient");
  const printed = printInvites(read);
  assert.match(printed, /invite:a-house "a-house" · invited by lantern-row \(credited as old-lantern, renamed since\)/);
  assert.match(printed, /invite:b-house "b-house" · invited by lantern-row \(named wick\) · at 2026-10-22T07:00:00\.000Z · ashore 2026-10-22T07:00:05\.000Z/);
  assert.match(printed, /the invited side: OWED 5 to b-house-r/);
  assert.match(printed, /the invited side: WAITING: its welcome bundle is not on the ledger yet/);
  assert.deepEqual(readInvites(store, { ledger, since: "2026-10-22T02:00:00.000Z" }).invitations.map((p) => p.household), ["b-house"], "--since lists only the newer ones");
  assert.match(printInvites(readInvites({ rows: [], houses, facts: {}, holds: new Map() })), /NOT READ AGAINST THE LEDGER[\s\S]*no household has joined with an invitation/);
});

test("I9c · the 30-day check (Wright's G5), and THE CAP COUNTS PAYOUTS IN THE MONTH THEY ARE PAID (POS-816/b, \"Month paid\")", async () => {
  const { activationOf, readInvites, printInvites } = await import("../tools/invites.mjs");
  const at = "2026-10-01T12:00:00.000Z";
  const now = new Date("2026-10-20T00:00:00.000Z");
  assert.deepEqual(activationOf({ at, letter: "2026-10-05T00:00:00.000Z", home: "2026-10-03T00:00:00.000Z", now }),
    { first_letter: "2026-10-05T00:00:00.000Z", first_home: "2026-10-03T00:00:00.000Z", by: "2026-11-01T04:00:00.000Z", status: "activated", at: "2026-10-03T00:00:00.000Z", through: "first home" },
    "the earlier of the two decides; the 30 days end where the 31st town day (11-01) begins, midnight EDT");
  // THE 30 DAYS ARE TOWN DAYS, the town judge's own count (Wright, on Darko's behalf, 2026-11-03). Until 2026-11-03 this
  // asserted 30×24 hours: 10-31T12:00:01Z read late and 2026-11-01T00:00Z read lapsed. Both are town day 10-31, the 30th.
  assert.equal(activationOf({ at, letter: "2026-10-31T12:00:00.000Z", now }).status, "activated", "the 30th day's own instant is within");
  assert.equal(activationOf({ at, letter: "2026-10-31T12:00:01.000Z", now }).status, "activated", "still the 30th town day");
  assert.equal(activationOf({ at, letter: "2026-11-01T04:00:00.000Z", now }).status, "late", "the 31st town day's first instant");
  assert.equal(activationOf({ at, now }).status, "waiting", "neither yet, the 30 days still running");
  assert.equal(activationOf({ at, now: new Date("2026-11-01T00:00:00.000Z") }).status, "waiting", "still town day 10-31");
  assert.equal(activationOf({ at, now: new Date("2026-11-01T04:00:00.000Z") }).status, "lapsed");
  // twelve invited by quill-hall: eleven activate in October, one never does;
  // read on 2026-11-20 every week has passed, so all eleven are due in November.
  const rows = Array.from({ length: 12 }, (_, i) => ({ slug: `h${String(i).padStart(2, "0")}`, residents: [`r${i}`],
    invited_by: { by: "quill-hall", named: "quill", at: `2026-10-0${1 + (i % 9)}T12:00:00.000Z` } }));
  const letters = new Map(rows.slice(0, 11).map((r, i) => [r.slug, `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00.000Z`]));
  const houses = [{ slug: "quill-hall", residents: ["quill"], formerly: [] }];
  const read = readInvites({ rows, houses, facts: { letters }, holds: new Map() }, { ledger: EMPTY_LEDGER(), now: new Date("2026-11-20T12:00:00.000Z") });
  const by = (s) => read.invitations.find((p) => p.household === s).inviter_side;
  assert.equal(by("h11").status, "lapsed", "invited 10-03 and read 11-20, no letter or home: it never activated, and takes no place in the cap");
  const owed = read.invitations.filter((p) => p.inviter_side.status === "owed");
  assert.equal(owed.length, 10, "ten are paid in the month they are paid in");
  assert.deepEqual(owed.map((p) => p.inviter_side.nth_this_month).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(by("h10").status, "over-cap", "the eleventh, due last, waits for a month with room");
  assert.equal(by("h10").month, "2026-11");
  // the same eleven when October's ten are already on the ledger: November has room for all of them again
  const paidOct = EMPTY_LEDGER(); paidOct.paidInMonth.set("quill-hall|2026-10", 10);
  assert.equal(readInvites({ rows, houses, facts: { letters }, holds: new Map() }, { ledger: paidOct, now: new Date("2026-11-20T12:00:00.000Z") })
    .invitations.filter((p) => p.inviter_side.status === "owed").length, 10, "a month already full counts against itself, never against the month paid");
  const printed = printInvites(read);
  assert.match(printed, /invite:h10[\s\S]*?the inviter side: OVER THE CAP: quill-hall has been paid 10 in 2026-11, at most 10 a month; it waits for a month with room/);
  assert.match(printed, /first letter 2026-10-10T12:00:00\.000Z · first home none · ACTIVATED 2026-10-10T12:00:00\.000Z \(first letter\)/);
});

test("I9e · the read plans a founders' row like any other (POS-816/d), and still shows the town's own house as REFUSED", async () => {
  // Until 2026-11-03 this asserted POS-576/e: a starforge row read REFUSED (founders) on both sides, "even with its
  // welcome paid and a letter in time", and took no place in the cap.
  const { readInvites, printInvites } = await import("../tools/invites.mjs");
  const rows = [
    { slug: "by-hand", residents: ["bh"], invited_by: { by: "starforge", named: "wright", at: "2026-10-02T12:00:00.000Z" } },
    { slug: "ordinary", residents: ["or"], invited_by: { by: "quill-hall", named: "quill", at: "2026-10-03T12:00:00.000Z" } },
    { slug: "town-row", residents: ["tr"], invited_by: { by: "the-town", named: "pen", at: "2026-10-04T12:00:00.000Z" } },
  ];
  const letters = new Map([["by-hand", "2026-10-04T00:00:00.000Z"], ["ordinary", "2026-10-05T00:00:00.000Z"], ["town-row", "2026-10-06T00:00:00.000Z"]]);
  const ledger = EMPTY_LEDGER();
  ledger.welcomes.set("by-hand", { handle: "bh", key: "hh:by-hand", date: "2026-10-02" });
  ledger.welcomes.set("town-row", { handle: "tr", key: "hh:town-row", date: "2026-10-04" });
  const read = readInvites({ rows, houses: [{ slug: "starforge", residents: ["wright"] }, { slug: "quill-hall", residents: ["quill"] }, { slug: "the-town", residents: ["pen"] }], facts: { letters }, holds: new Map() },
    { ledger, now: new Date("2026-10-20T00:00:00.000Z") });
  const hand = read.invitations.find((p) => p.household === "by-hand");
  assert.equal(hand.refused, undefined);
  assert.deepEqual([hand.invited_side.status, hand.inviter_side.status], ["owed", "owed"], "both sides, with its welcome paid and a letter in time");
  assert.deepEqual([hand.invited_side.to, hand.inviter_side.to, hand.inviter_side.nth_this_month], ["bh", "wright", 1]);
  assert.equal(read.invitations.find((p) => p.household === "ordinary").inviter_side.nth_this_month, 1, "each inviting house keeps its own count");
  const town = read.invitations.find((p) => p.household === "town-row");
  assert.equal(town.refused, "town");
  assert.deepEqual([town.invited_side.status, town.inviter_side.status], ["refused", "refused"], "the town's own house pays neither side, welcome paid and letter in time");
  const printed = printInvites(read);
  const block = (slug, next) => printed.split(`invite:${slug}`)[1].split(`invite:${next}`)[0];
  assert.match(block("by-hand", "ordinary"), /the invited side: OWED 5 to bh/);
  assert.match(block("by-hand", "ordinary"), /the inviter side: OWED 10 to wright/);
  assert.doesNotMatch(block("by-hand", "ordinary"), /REFUSED/);
  assert.match(printed.split("invite:town-row")[1], /the invited side: REFUSED \(the town's own house\): nothing is owed to either side; the invitee has the ordinary bundle/);
  assert.doesNotMatch(printed.split("invite:town-row")[1], /OWED/, "no mint line for it");
});

test("I9b · the read, run as the operator runs it, on the real store: it lists the households I8a, I8c and I8e invited and nothing it didn't", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "invites.mjs"), "--json"], { encoding: "utf8", env: { ...process.env, ...IX.env, TOWN_CLONE: "" } });
  assert.equal(r.status, 0, r.stderr);
  const read = JSON.parse(r.stdout);
  assert.equal(read.ledger_read, false, "no town clone: it says it did not read the ledger");
  assert.equal(read.holds_read, true, "087 is in the store");
  assert.deepEqual(read.invitations.map((p) => [p.household, p.invited_by, p.named]), [
    ["new-hearth", "lantern-row", "wick"], ["lamplight-rooms", "rookery-row", "moth"], ["candlewick-den", "moth", "hh:moth"],
    ["guest-of-the-founders", "starforge", "wright"]]);   // I8e's: until 2026-11-03 the founders' join recorded no credit and was not listed
  assert.match(read.invitations[0].ashore ?? "", /^\d{4}-\d\d-\d\dT/, "when it came ashore, by the store's own record");
  assert.equal(read.invitations[0].activation.status, "waiting", "no letter and no home yet");
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
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "invites.mjs"), "--json"], { encoding: "utf8", env: { ...process.env, ...IX.env, TOWN_CLONE: "" } });
  assert.equal(r.status, 0, r.stderr);
  const [p] = JSON.parse(r.stdout).invitations;
  assert.equal(p.activation.first_letter, later, "the delivered letter counts; the undelivered one does not");
  assert.equal(p.activation.first_home, soon, "the parcel's home is the close of the window that locked it");
  assert.equal(p.activation.at, soon, "the earlier of the two");
  assert.equal(p.activation.status, "activated");
});
