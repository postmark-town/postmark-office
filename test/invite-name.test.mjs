// invite-name.test.mjs — a household names who invited it, after it joined (POS-947).
//
// Darko 2026-11-07 23:05 EST (POS-816/c): "open to any amount of time for the
// backfill for referrals, and we just check basic logic preventing loops";
// 2026-11-08 (POS-947/b): "joined before" is the order the town recorded
// households, `households.ord`, never `since`. Asked for by Little Bird.
//
// Every house, handle, login and id here is INVENTED.
//
//   N1  the naming house is the verified key's, never the body's
//   N2  the judge: older only (by ord, not since), once, never self, same house, town or meep
//   N3  THE REAL ROAD: invite-name-exec on a real store and a real clone lands
//       the credit on the row AND in its own commit's printed registry, once
//   N4  refusals write nothing: second naming, younger, same house, meep, the
//       town, another household's resident, an unread law
//   N5  whole or nothing: a refused drain or an unlanded commit takes the row back
//   N6  a ONE-OFF (POS-947/c): off the permanent menu, still callable and its card readable
//   N7  OFFERED IN the v2 glance's first_steps only to a house that names
//       nobody, gone once it names, never in `can`; the newly joined
//       inviter-less house's bare reads measured (neither cap rises)
//
//   node --test test/invite-name.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";

import { judgeLateInvite, lateInvitedBy, lateInviteRefusal, lateInviteReceipt, LATE_INVITE_ACT, TOWN_HOUSE } from "../src/arrival-invite.mjs";
import { namingHouse, nameInviterUnderLock, nameInviterViaOffice } from "../src/invite-name.mjs";
import { notLandedError } from "../src/write.mjs";
import { householdApex, APEX_ONLY_FIELDS, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_OFFERED, HOUSEHOLD_READ_ENUM, HOUSEHOLD_TOOL, capabilityIndex } from "../src/household-apex.mjs";
import { HOUSEHOLD_LINES } from "../src/door-read-shape.mjs";
import { fixtureTown, put } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";

delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;
// The bare answers are measured as foyer-shrink.test.mjs measures them: card
// blurbs from the office's own `inline` (no world store), and a fixed world block.
process.env.WORLD_STORE_DB = join(tmpdir(), "pm-invite-name-no-such-world-store.db");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN_CLONE = join(ROOT, "town-clone");

// THE ORDER IS THE KEY ORDER (rowsFromRegistry numbers `ord` as it reads), and
// two houses' `since` run AGAINST it on purpose: newer-row was recorded after
// late-house but carries an earlier date, so a judge reading `since` decides
// both of its cases the wrong way round.
const REGISTRY = () => ({ schema_version: 1, note: "invented for POS-947", households: {
  [TOWN_HOUSE]: { name: "the town", accounts: [{ login: "town-gh", id: 9400 }], residents: ["town-pen"], since: "2026-07-01", declared_by: "fixture" },
  "lantern-row": { name: "Lantern Row", accounts: [{ login: "lr-gh", id: 9401 }], residents: ["wick", "ember-lamp"], since: "2026-08-01", declared_by: "fixture" },
  "quill-hall": { name: "Quill Hall", accounts: [{ login: "qh-gh", id: 9402 }], residents: ["quill"], since: "2026-08-03", declared_by: "fixture" },
  "late-house": { name: "Late House", accounts: [{ login: "lh-gh", id: 9403 }], residents: ["lark", "linnet"], since: "2026-09-10", declared_by: "fixture" },
  "named-house": { name: "Named House", accounts: [{ login: "nh-gh", id: 9404 }], residents: ["nell"], since: "2026-09-11", declared_by: "fixture",
    invited_by: { by: "lantern-row", named: "wick", at: "2026-09-11T14:00:00.000Z" } },
  "newer-row": { name: "Newer Row", accounts: [{ login: "nr-gh", id: 9405 }], residents: ["newt"], since: "2026-08-02", declared_by: "fixture" },
  "fresh-house": { name: "Fresh House", accounts: [{ login: "fh-gh", id: 9406 }], residents: ["fern"], since: "2026-10-01", declared_by: "fixture" },
} });
const PINS = () => ({
  "town-pen": { login: "town-gh", id: 9400, pinned: "2026-07-01" },
  wick: { login: "lr-gh", id: 9401, pinned: "2026-08-01" },
  "ember-lamp": { login: "lr-gh", id: 9401, pinned: "2026-08-01" },
  quill: { login: "qh-gh", id: 9402, pinned: "2026-08-03" },
  lark: { login: "lh-gh", id: 9403, pinned: "2026-09-10" },
  linnet: { login: "lh-gh", id: 9403, pinned: "2026-09-10" },
  nell: { login: "nh-gh", id: 9404, pinned: "2026-09-11" },
  newt: { login: "nr-gh", id: 9405, pinned: "2026-08-02" },
  fern: { login: "fh-gh", id: 9406, pinned: "2026-10-01" },
});
const ORD = Object.fromEntries(Object.keys(REGISTRY().households).map((s, i) => [s, i]));
const ordOf = (s) => ORD[s] ?? null;
const isMeep = (h) => h === "ember-lamp";
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const late = (invited_by, own, extra = {}) => judgeLateInvite({ invited_by }, { registry: REGISTRY(), own, isMeep, ordOf, ...extra });
const LATE = { slug: "late-house", handle: "lark" };

// ── N1 the naming house ─────────────────────────────────────────────────────

test("N1 · the naming house is the verified key's: its one house, or the resident it names; never one it does not keep", () => {
  const reg = REGISTRY();
  assert.deepEqual(namingHouse(reg, new Set(["lark", "linnet"])), { slug: "late-house", handle: "lark" });
  assert.deepEqual(namingHouse(reg, ["linnet"], "linnet"), { slug: "late-house", handle: "linnet" });
  const foreign = namingHouse(reg, ["quill"], "lark");
  assert.equal(foreign.error.code, 403, "another household's resident, named in the body, is refused");
  assert.match(foreign.error.defect, /"lark" is not one of your residents/);
  const two = namingHouse(reg, ["lark", "quill"]);
  assert.equal(two.error.code, 422, "a key keeping two houses is asked which, never guessed for");
  assert.deepEqual(namingHouse(reg, ["lark", "quill"], "quill"), { slug: "quill-hall", handle: "quill" });
  assert.equal(namingHouse(reg, ["nobody"]).error.code, 403, "a key with no house on the record names nothing");
  assert.equal(namingHouse(reg, []).error.code, 403);
});

// ── N2 the judge ────────────────────────────────────────────────────────────

test("N2 · the judge credits an OLDER house by its resident or hh:<slug>, and the credit is the join's own plus backfill", () => {
  assert.deepEqual(late("wick", LATE), { by: "lantern-row", named: "wick" });
  assert.deepEqual(late("hh:quill-hall", LATE), { by: "quill-hall", named: "hh:quill-hall" });
  const at = new Date("2026-11-08T15:00:00.000Z");
  assert.deepEqual(lateInvitedBy({ by: "lantern-row", named: "wick" }, at),
    { by: "lantern-row", named: "wick", at: "2026-11-08T15:00:00.000Z", backfill: true }, "the naming instant, and backfill marks it");
  assert.equal(LATE_INVITE_ACT, "invited-by");
  assert.match(lateInviteReceipt({ by: "lantern-row", named: "wick" }), /^Recorded publicly: invited by lantern-row \(wick\), named after you joined\. .*10 a week after this naming/);
});

test("N2b · JOINED BEFORE IS THE TOWN'S ORDER (POS-947/b), never since: a later-recorded house is refused even with an earlier date", () => {
  const younger = late("newt", LATE);
  assert.equal(younger.refused, "younger", "newer-row's since (08-02) is before late-house's (09-10), but it was recorded after");
  assert.equal(younger.by, "newer-row");
  assert.deepEqual(late("lark", { slug: "newer-row", handle: "newt" }), { by: "late-house", named: "lark" },
    "and the other way round is lawful: late-house was recorded first, whatever its date says");
  assert.equal(late("fern", LATE).refused, "younger");
  // NO LOOP CAN CLOSE: of any two houses, exactly one may name the other.
  for (const a of Object.keys(ORD)) for (const b of Object.keys(ORD)) {
    if (a === b || a === TOWN_HOUSE || b === TOWN_HOUSE) continue;
    const ab = !late(`hh:${b}`, { slug: a }).refused, ba = !late(`hh:${a}`, { slug: b }).refused;
    assert.ok(!(ab && ba), `${a} and ${b} cannot name each other`);
    assert.ok(ab || ba, `one of ${a}, ${b} may name the other`);
  }
  assert.equal(judgeLateInvite({ invited_by: "wick" }, { registry: REGISTRY(), own: LATE, isMeep, ordOf: () => null }).refused, "younger",
    "an order the judge cannot read refuses: it never credits on a guess");
});

test("N2c · refused by name: a second naming, your own house or housemate, the town, a meep, a stranger, an unread law", () => {
  const second = late("quill", { slug: "named-house", handle: "nell" }, { current: { by: "lantern-row" } });
  assert.deepEqual(second, { refused: "already", named: "quill", by: "lantern-row" }, "named once, never changed");
  assert.equal(late("lark", LATE).refused, "own");
  assert.equal(late("linnet", LATE).refused, "own", "a housemate is your own house");
  assert.equal(late("hh:late-house", LATE).refused, "own");
  assert.equal(late("town-pen", LATE).refused, "town");
  assert.equal(late("hh:the-town", LATE).refused, "town");
  assert.equal(late("ember-lamp", LATE).refused, "meep");
  assert.equal(late("nobody-here", LATE).refused, "unknown");
  assert.equal(late("wick", LATE, { isMeep: null }).refused, "law", "the meep law fails closed");
  assert.equal(late("", LATE).refused, "none");
  const codes = Object.fromEntries(["none", "already", "younger", "own", "town", "meep", "unknown", "law"]
    .map((r) => [r, lateInviteRefusal({ refused: r, named: "x", by: "y" }).code]));
  assert.deepEqual(codes, { none: 422, already: 409, younger: 409, own: 422, town: 422, meep: 422, unknown: 404, law: 503 });
});

// ── N3–N5 the real road ─────────────────────────────────────────────────────
//
// src/invite-name-exec.mjs spawned as the door spawns it, against a real store
// (the embedded Postgres, every migration applied, 085 among them) and a real
// git clone holding the town's own engine and a sealed meep law
// (arrival-invite.test.mjs § I8's harness).

// THE NEWLY JOINED HOUSE (POS-947/c's measurement): fern, of fresh-house, is
// ashore in the town's index with nothing tended yet (no home, no window, no
// parcel), so the bare answer carries every settling line AND the offer.
const TOWN = fixtureTown();
put(TOWN, "residents", { handle: "fern", json: JSON.stringify({
  handle: "fern", is_office: false, last_active: "2026-11-08T12:00:00.000Z",
  address: { data: { since: "2026-11-08", joined: "2026-11-08", github: "fh-gh" }, body: "# fern" },
}) });
const IX = await indexStore(TOWN);
const IX_RESTORE = await IX.useInProcess();
const RECORD_RESTORE = await recordInProcess(IX.store);
test.after(async () => { await RECORD_RESTORE(); await IX_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const ENGINE = await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs")).href);
const LAW_KEYS = generateKeyPairSync("ed25519");
function sealedLedger(lines) {
  const seals = ENGINE.sealChain(lines);
  return "# the stamp ledger\n\n" + lines.map((l, i) => `${l} · sig: ${sign(null, Buffer.from(seals[i], "utf8"), LAW_KEYS.privateKey).toString("base64url")}`).join("\n") + "\n";
}
function townClone({ law = true, registry = REGISTRY() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pm-invite-name-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  if (law) {
    copyFileSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"), join(dir, "tools", "stamp-mint.mjs"));
    writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), LAW_KEYS.publicKey.export({ type: "spki", format: "pem" }));
    mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), sealedLedger([
      "- 2026-06-12 · rules: stamps-v1",
      "- 2026-07-25 · rules: stamps-v3 · meeps: ember-lamp · friendship: 5:5,10:10",
    ]));
  }
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(registry));
  writeFileSync(join(dir, PINS_PATH), serializePins(PINS()));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "user.email", "fixture@test.invalid");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture town");
  return dir;
}

function nameExec(args, handles, at) {
  const r = spawnSync(process.execPath, [join(ROOT, "src", "invite-name-exec.mjs"), JSON.stringify({ args, key: { handles } })], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: at, TOWN_PUSH: "", BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid" },
  });
  assert.equal(r.status, 0, `invite-name-exec answers rather than trips: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}
async function rowOf(slug) {
  const c = await IX.store.connect("office_api");
  try { return (await c.query("SELECT invited_by FROM households WHERE slug = $1", [slug])).rows[0]?.invited_by ?? null; }
  finally { await c.end(); }
}
const printedIn = (clone, rev = "HEAD") => JSON.parse(git(clone, "show", `${rev}:${REGISTRY_PATH}`)).households;
const headOf = (clone) => git(clone, "rev-parse", "HEAD");

test("N3 · THE REAL ROAD: a household names its older inviter long after joining; the row and its own commit's registry carry the credit, once", async () => {
  await seedRegistry(IX.store, REGISTRY(), PINS());
  const clone = townClone();
  const before = headOf(clone);
  const out = nameExec({ invited_by: "@Wick" }, ["lark", "linnet"], clone);
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  assert.equal(out.household, "late-house");
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(clone, "rev-parse", `${out.commit}^`), before, "one commit");
  assert.match(git(clone, "log", "-1", "--format=%s", out.commit), /^household: late-house names who invited it · lantern-row \(via postmark-office, invited-by\)$/);
  const row = await rowOf("late-house");
  assert.deepEqual(Object.keys(row).sort(), ["at", "backfill", "by", "named"]);
  assert.equal(row.by, "lantern-row");
  assert.equal(row.named, "wick", "the name as it was given: truthful provenance");
  assert.equal(row.backfill, true);
  assert.ok(Date.parse(row.at) > Date.parse("2026-09-10"), "`at` is the naming instant, not the join day");
  assert.deepEqual(printedIn(clone, out.commit)["late-house"].invited_by, row, "the public record, in the same commit, in full");
  assert.deepEqual(Object.keys(printedIn(clone, out.commit)["late-house"].invited_by), ["by", "named", "at", "backfill"], "in template order");
  assert.equal("invited_by" in printedIn(clone, out.commit)["lantern-row"], false, "the inviter's own row is untouched");
  assert.equal(out.invite, lateInviteReceipt({ by: "lantern-row", named: "wick" }));

  // NAMED ONCE: the same house asking again, for anyone, is refused and nothing moves.
  const again = nameExec({ invited_by: "quill" }, ["linnet"], clone);
  assert.equal(again.error.code, 409);
  assert.match(again.error.defect, /already names who invited it \(lantern-row\)/);
  assert.deepEqual(await rowOf("late-house"), row, "the credit stands as first named");
  assert.equal(headOf(clone), out.commit, "and the town has no second commit");
  const retry = nameExec({ invited_by: "wick" }, ["lark"], clone);
  assert.equal(retry.error.code, 409, "the same name again is refused too: a retry never writes twice");
  assert.equal(headOf(clone), out.commit);
});

test("N4 · every refusal writes nothing: younger by ord, same house, the town, a meep, a stranger, another household's resident, an unread law", async () => {
  await seedRegistry(IX.store, REGISTRY(), PINS());
  const clone = townClone();
  const head = headOf(clone);
  const cases = [
    [{ invited_by: "newt" }, ["lark"], 409, /newer-row, and you can name only a household that joined before yours/],
    [{ invited_by: "linnet" }, ["lark"], 422, /your own household/],
    [{ invited_by: "town-pen" }, ["lark"], 422, /town/],
    [{ invited_by: "ember-lamp" }, ["lark"], 422, /meeps can't be named/],
    [{ invited_by: "nobody-here" }, ["lark"], 404, /nobody-here/],
    [{ invited_by: "wick", handle: "lark" }, ["quill"], 403, /"lark" is not one of your residents/],
    [{ invited_by: "quill" }, ["nell"], 409, /already names who invited it \(lantern-row\)/],
  ];
  for (const [args, handles, code, defect] of cases) {
    const out = nameExec(args, handles, clone);
    assert.equal(out.error?.code, code, `${JSON.stringify(args)} by ${handles}: ${JSON.stringify(out)}`);
    assert.match(out.error.defect, defect);
  }
  assert.equal(await rowOf("late-house"), null, "late-house is still unnamed");
  assert.equal((await rowOf("named-house")).by, "lantern-row", "and named-house still names whom it named at joining");
  assert.equal(headOf(clone), head, "no refusal reached the town");

  const lawless = townClone({ law: false });
  const blind = nameExec({ invited_by: "wick" }, ["lark"], lawless);
  assert.equal(blind.error.code, 503, "an unread meep law refuses: it fails closed");
  assert.equal(await rowOf("late-house"), null);
});

test("N5 · WHOLE OR NOTHING: a drain that refuses, or a commit that cannot land, takes the row back; asking again then lands", async () => {
  await seedRegistry(IX.store, REGISTRY(), PINS());
  // The shrink guard: the clone's printout holds a house the store does not, so the drain refuses before a byte.
  const ahead = REGISTRY();
  ahead.households["ghost-house"] = { name: "Ghost House", accounts: [{ login: "gh-gh", id: 9499 }], residents: ["ghost"], since: "2026-10-02", declared_by: "fixture" };
  const stale = townClone({ registry: ahead });
  const head = headOf(stale);
  const refused = nameExec({ invited_by: "wick" }, ["lark"], stale);
  assert.equal(refused.error?.code, 503, JSON.stringify(refused));
  assert.match(refused.error.defect, /registry could not be printed, so nothing was recorded/);
  assert.equal(await rowOf("late-house"), null, "the row was taken back");
  assert.equal(headOf(stale), head);

  const clone = townClone();
  const lost = await nameInviterUnderLock({ args: { invited_by: "wick" }, key: { handles: ["lark"] }, clone,
    commit: () => { throw notLandedError("a fixture race"); } });
  assert.equal(lost.error?.code, 503, JSON.stringify(lost));
  assert.equal(await rowOf("late-house"), null, "a push that could not land takes the row back too");
  await assert.rejects(nameInviterUnderLock({ args: { invited_by: "wick" }, key: { handles: ["lark"] }, clone,
    commit: () => { throw new Error("the pen tripped"); } }), /the pen tripped/);
  assert.equal(await rowOf("late-house"), null, "and so does a pen that trips");

  const landed = nameExec({ invited_by: "wick" }, ["lark"], clone);
  assert.equal(landed.error, undefined, JSON.stringify(landed.error));
  assert.equal((await rowOf("late-house")).by, "lantern-row", "a later naming lands: nothing was left half-written");
  // The take-back compares the credit WHOLE: it never clears a credit it did not write.
  const { unsetUnpublishedInvitedBy } = await import("../src/registry-store.mjs");
  assert.deepEqual(await unsetUnpublishedInvitedBy({ slug: "late-house", invitedBy: { by: "lantern-row", named: "wick", at: "2026-01-01T00:00:00.000Z", backfill: true } }),
    { slug: null });
  assert.equal((await rowOf("late-house")).by, "lantern-row");
});

// ── N6 the door ─────────────────────────────────────────────────────────────

test("N6 · A ONE-OFF (POS-947/c): off the permanent menu; callable by do:, its full card readable, its schema its own", async () => {
  assert.deepEqual(HOUSEHOLD_OFFERED, ["invited-by"]);
  assert.equal(HOUSEHOLD_DISPATCHABLE.includes("invited-by"), false, "not on the permanent menu");
  assert.equal(capabilityIndex().some((c) => c.act === "invited-by"), false, "nor on the connector's index");
  assert.ok(HOUSEHOLD_TOOL.inputSchema.properties.do.enum.includes("invited-by"), "a strict client can still call it");
  assert.ok(HOUSEHOLD_READ_ENUM.includes("invited-by"), "and read its card");
  assert.doesNotMatch(HOUSEHOLD_TOOL.inputSchema.properties.do.description, /invited-by/, "the do: prose names the menu only");
  assert.deepEqual(APEX_ONLY_FIELDS["invited-by"].required, ["invited_by"]);
  assert.deepEqual(Object.keys(APEX_ONLY_FIELDS["invited-by"].properties).sort(), ["handle", "invited_by"]);
  assert.equal("invited-by" in HOUSEHOLD_LINES, false, "no can-line: v2's can never advertises it");
  const seen = [];
  const run = async (payload) => { seen.push(payload); return { household: "late-house" }; };
  assert.deepEqual(await nameInviterViaOffice("/clone", { invited_by: "wick", handle: "lark" }, { handles: new Set(["lark"]) }, { run }), { household: "late-house" });
  assert.deepEqual(seen[0], { args: { invited_by: "wick", handle: "lark" }, key: { handles: ["lark"] } }, "the key's handles travel, never a body's");
  await assert.rejects(nameInviterViaOffice("/clone", { invited_by: "wick" }, { handles: new Set() }, { run }), (e) => e.code === 403);
  await assert.rejects(nameInviterViaOffice(null, { invited_by: "wick" }, { handles: new Set(["lark"]) }, { run }), (e) => e.code === 503);

  await seedRegistry(IX.store, REGISTRY(), PINS());
  const clone = townClone();
  const r = await householdApex({ do: "invited-by", args: { invited_by: "hh:quill-hall" } },
    { handles: new Set(["fern"]), ghId: 9406, ghLogin: "fh-gh" }, { clone, canWrite: true });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
  assert.equal(r.did, "invited-by");
  assert.equal(r.result.household, "fresh-house");
  assert.equal((await rowOf("fresh-house")).by, "quill-hall");
  const unknownField = await householdApex({ do: "invited-by", args: { invited_by: "wick", at: "2026-01-01" } },
    { handles: new Set(["lark"]) }, { clone, canWrite: true });
  assert.equal(unknownField.error, "bounce", "a field the act does not take (an `at` of the caller's choosing) bounces by name");
  assert.equal(await rowOf("late-house"), null);
});

// ── N7 the offer, and what it costs ─────────────────────────────────────────

const { TOOLS } = await import("../src/mcp.mjs");
const SCHEMAS = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
const unsited = async () => ({ sited: false, unreadable: false }); // newly joined: no parcel yet
const REST = (extra = {}) => ({ worldBlock: unsited, schemas: SCHEMAS, schemaRequired: REQUIRED, ...extra });
const SLIM = (extra = {}) => REST({ slim: true, ...extra });
const V2 = { read_shape: "v2" };
const FERN = { household: "fresh-house", handles: new Set(["fern"]), ghId: 9406, ghLogin: "fh-gh" };
const offer = (glance) => (glance?.house?.first_steps ?? []).filter((s) => s.startsWith("invited-by: "));
const served = (answer) => JSON.stringify(answer, null, 1).length; // the MCP's own serialization, as household-read-v2.test.mjs measures
const onMenu = (answer) => JSON.stringify(answer?.acts ?? []).includes('"invited-by"');

test("N7 · OFFERED IN first_steps to the house that names nobody, and only it; never in can or a menu; gone once it names", async (t) => {
  await seedRegistry(IX.store, REGISTRY(), PINS());
  const clone = townClone();

  const glance = await householdApex(V2, FERN, SLIM());
  assert.equal(glance.error, undefined, JSON.stringify(glance).slice(0, 300));
  assert.deepEqual(offer(glance), ['invited-by: household { do: "invited-by", args: { invited_by: "<their handle, or hh:<slug>>" } }: if someone invited your house; once, public'],
    `the newly joined, inviter-less house is offered the naming: ${JSON.stringify(glance.house?.first_steps)}`);
  assert.ok(glance.house.first_steps.some((s) => s.startsWith("home: ")), "beside its missing papers: a newly joined house");
  assert.ok(!JSON.stringify(glance.can).includes("invited-by"), "never in can");
  const legacy = await householdApex({}, FERN, REST());
  const legacySlim = await householdApex({}, FERN, SLIM());
  assert.equal(onMenu(legacy) || onMenu(legacySlim), false, "nor on the older shapes' act menus");
  assert.ok(!JSON.stringify(legacy.next).includes("invited-by"), "and never in next");

  // THE CALLED FIGURES (POS-947/c): this house's bare reads, as served, with the offer.
  const restGlance = await householdApex(V2, FERN, REST());
  t.diagnostic(`newly joined inviter-less house (fern), offered the naming: v2 glance (household { read_shape: "v2" }) ${served(glance)} chars as served on the connector skin, ${served(restGlance)} on REST`);

  // the card reads in full by name, with its schema's fields
  const card = await householdApex({ read: "invited-by" }, FERN, REST());
  assert.equal(card.read, "invited-by");
  assert.deepEqual(Object.keys(card.card.fields).sort(), ["handle", "invited_by"]);
  assert.match(card.card.fields.invited_by.description, /named once and never changed/);

  // NOT OFFERED: a house that named at joining; a house still at the harbor (the act would bounce there)
  const nell = await householdApex(V2, { household: "named-house", handles: new Set(["nell"]), ghId: 9404, ghLogin: "nh-gh" }, SLIM());
  assert.equal(nell.error, undefined, JSON.stringify(nell).slice(0, 300));
  assert.deepEqual(offer(nell), [], "named at joining: no offer");
  const harbor = await householdApex(V2, { ...FERN, harbor: true }, SLIM());
  assert.deepEqual(offer(harbor), [], "at the harbor the act would bounce, so it is not offered");

  // NAMING REMOVES IT, and the act stays callable and guarded
  const did = await householdApex({ do: "invited-by", args: { invited_by: "hh:quill-hall" } }, FERN, { clone, canWrite: true });
  assert.equal(did.error, undefined, JSON.stringify(did).slice(0, 300));
  assert.deepEqual(offer(await householdApex(V2, FERN, SLIM())), [], "the offer is gone the moment the naming lands");
  const twice = await householdApex({ do: "invited-by", args: { invited_by: "wick" } }, FERN, { clone, canWrite: true });
  assert.equal(twice.code, 409, "and the act refuses a second naming");
  assert.equal((await householdApex({ read: "invited-by" }, FERN, REST())).read, "invited-by", "its card stays readable after");
});
