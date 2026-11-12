// resident-name.test.mjs — POS-1005 part 1 of 3: a resident's NAME is at most 48 reader-characters, with one size ceiling behind it.
//
// Darko, 2026-11-11 22:17 EST: "48 characters". Wright, 2026-11-12 07:40Z: "48 reader-characters is the one rule residents are told, and one size ceiling stays
// behind it": over the limit is REFUSED with the limit and the actual count, never trimmed; the old silent 200-unit slice is gone; 500 UTF-8 bytes is kept behind
// the character check with its own plain words ("that name is too large to store; use fewer symbols"). A name already on file over the limit is NOT linted: an
// edit that does not change it leaves it as it was. Every house, handle and name here is INVENTED.
//
//   § 1  the counter: reader-characters, not UTF-16 units and not code points
//   § 2  the byte ceiling behind it
//   § 3  the doors: ADDRESS fields, PROFILE display_name, the joins, the keyless begin
//   § 4  a legacy long name survives every unrelated edit
//
//   node --test test/resident-name.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { NAME_LIMIT, NAME_BYTES, graphemeCount, nameRefusal } from "../src/resident-name.mjs";
import { updateAddressFields, updateAddressBody, updateProfile } from "../src/edit.mjs";
import { validateResidencyRequest, buildJoinCard, buildBerthCard } from "../src/residency.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { openOauthDb, mintBerth } from "../src/oauth.mjs";

const FAMILY = "👨‍👩‍👧‍👦";            // one reader-character: 11 UTF-16 units, 7 code points, 25 bytes
const FLAG = "🇫🇷";                 // one reader-character: 4 units, 2 code points
const ACUTE = "é";            // one reader-character: 2 units, 2 code points
const n = (c, k) => c.repeat(k);

// ── § 1 the counter ─────────────────────────────────────────────────────────

test("§ 1 the limit is 48 reader-characters, counted as a reader sees them: family emoji, flags and combining marks are ONE each", () => {
  assert.equal(NAME_LIMIT, 48); assert.equal(NAME_BYTES, 500);
  assert.equal(graphemeCount(n(FAMILY, 48)), 48); assert.equal(n(FAMILY, 48).length, 528, "528 UTF-16 units: a unit counter would refuse this name");
  assert.equal(graphemeCount(n(FLAG, 48)), 48); assert.equal([...n(FLAG, 48)].length, 96, "96 code points: a code-point counter would refuse this name");
  assert.equal(graphemeCount(n(ACUTE, 48)), 48); assert.equal([...n(ACUTE, 48)].length, 96);
  assert.equal(graphemeCount(n("x", 49)), 49);
  assert.equal(graphemeCount(""), 0); assert.equal(graphemeCount(null), 0);
});

test("§ 1 48 is accepted and 49 is refused with the limit and the ACTUAL count, for plain text and for combining and flag names (a UTF-16 or code-point counter fails these)", () => {
  assert.equal(nameRefusal(n("x", 48)), null);
  assert.equal(nameRefusal(n(ACUTE, 48)), null, "48 letters-with-accents are 48, not 96");
  assert.equal(nameRefusal(n(FLAG, 48)), null, "48 flags are 48, not 96 code points or 192 units");
  for (const [name, count] of [[n("x", 49), 49], [n(ACUTE, 49), 49], [n(FLAG, 49), 49], [n("x", 200), 200]]) {
    const r = nameRefusal(name);
    assert.equal(r.code, 422); assert.equal(r.defect, `that name is ${count} characters; a name is at most 48`);
  }
  assert.equal(nameRefusal(""), null, "an empty name is the doors' own default/clear, not judged here");
});

// ── § 2 the byte ceiling ────────────────────────────────────────────────────

test("§ 2 the 500-byte ceiling stays behind the character check, with its own plain words; 48 family emoji (1,200 bytes) meet it and are refused, never cut", () => {
  const big = nameRefusal(n(FAMILY, 48));
  assert.deepEqual([big.code, big.defect], [413, "that name is too large to store; use fewer symbols"]);
  assert.equal(Buffer.byteLength(n(FAMILY, 48), "utf8"), 1200);
  // a stack of marks: ONE reader-character, unbounded bytes: the reason the ceiling exists
  const stacked = "a" + "́".repeat(400);
  assert.equal(graphemeCount(stacked), 1);
  assert.equal(nameRefusal(stacked).defect, "that name is too large to store; use fewer symbols");
  // the character rule is judged FIRST: a name over 48 that is also over 500 bytes is told its count
  assert.match(nameRefusal(n(FAMILY, 60)).defect, /^that name is 60 characters; a name is at most 48$/);
  // and a name within both is fine at the edge: 48 three-byte characters are 144 bytes
  assert.equal(nameRefusal(n("é", 48)), null);
  assert.equal(nameRefusal("x".repeat(48)), null);
});

// ── the card the doors edit ─────────────────────────────────────────────────

const CARD = (agent) => ["---", "handle: tester", "github: tester-gh", "since: 2026-01-01", "joined: 2026-08-01", `agent: ${agent}`, "note: an early note", "---", "", "the prose below the fence", ""].join("\n");
function clone(agent = "Tester") {
  const dir = mkdtempSync(join(tmpdir(), "pm-name-"));
  mkdirSync(join(dir, "WHITE_PAGES", "tester"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "tester", "ADDRESS.md"), CARD(agent));
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"], { stdio: "ignore" });
  return dir;
}
const key = () => ({ household: "testers", handles: new Set(["tester"]), ghId: "1", ghLogin: "tester-gh" });
const cardOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "tester", "ADDRESS.md"), "utf8");
const nameOf = (dir) => /^agent: (.*)$/m.exec(cardOf(dir))[1];
const odb = () => { const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return db; };
const asDoor = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── § 3 the doors ───────────────────────────────────────────────────────────

test("§ 3 ADDRESS agent: 49 is refused with the count and writes NOTHING; 48 lands; a byte-heavy 48 is refused, never cut", async () => {
  const dir = clone();
  const before = cardOf(dir);
  const long = await asDoor(() => updateAddressFields({ handle: "tester", agent: n("x", 49) }, key(), null, dir));
  assert.equal(long.code, 422); assert.equal(long.defect, "that name is 49 characters; a name is at most 48");
  assert.equal(cardOf(dir), before, "a refused name leaves the card byte-identical");
  const heavy = await asDoor(() => updateAddressFields({ handle: "tester", agent: n(FAMILY, 48) }, key(), null, dir));
  assert.deepEqual([heavy.code, heavy.defect], [413, "that name is too large to store; use fewer symbols"]);
  assert.equal(cardOf(dir), before, "and it is not silently cut either");
  for (const ok of [n("x", 48), n(ACUTE, 48), n(FLAG, 48)]) { await updateAddressFields({ handle: "tester", agent: ok }, key(), null, dir); assert.equal(nameOf(dir), ok); }
  await updateAddressFields({ handle: "tester", agent: "" }, key(), null, dir);
  assert.equal(nameOf(dir), "(unstated)", "clearing still works");
});

test("§ 3 PROFILE display_name is the same rule, through the same door (no second cap, no second wording)", async () => {
  const dir = clone();
  const before = cardOf(dir);
  const e = await asDoor(() => updateProfile({ handle: "tester", display_name: n("x", 57) }, key(), null, dir));
  assert.equal(e.code, 422); assert.equal(e.defect, "that name is 57 characters; a name is at most 48");
  assert.equal(cardOf(dir), before);
  updateProfile({ handle: "tester", display_name: n("x", 48) }, key(), null, dir);
  assert.equal(nameOf(dir), n("x", 48));
});

test("§ 3 the joins: request_residency, declaration and the bound join judge `agent` in validateResidencyRequest, before anything is planned or written", () => {
  const card = "a few paragraphs about who I am, in my own voice";
  const mem = { hasResident: () => false };   // nobody lives here yet (index-probe.mjs § probeOf)
  assert.deepEqual(validateResidencyRequest({ handle: "newcomer-one", card, agent: n("x", 48) }, mem), { handle: "newcomer-one" });
  const e = (() => { try { validateResidencyRequest({ handle: "newcomer-one", card, agent: ` ${n("x", 49)} ` }, mem); } catch (err) { return err; } })();
  assert.equal(e.code, 422); assert.equal(e.defect, "that name is 49 characters; a name is at most 48", "judged as it would be written: trimmed");
  const heavy = (() => { try { validateResidencyRequest({ handle: "newcomer-one", card, agent: n(FAMILY, 48) }, mem); } catch (err) { return err; } })();
  assert.equal(heavy.defect, "that name is too large to store; use fewer symbols");
  assert.equal(validateResidencyRequest({ handle: "newcomer-one", card }, mem).handle, "newcomer-one", "no agent: the card defaults it, nothing to judge");
  // and the cards the joins write carry a valid name exactly as given (nothing here cuts)
  assert.match(buildJoinCard({ handle: "newcomer-one", card, agent: n("x", 48), ghLogin: "gh" }), new RegExp(`\\nagent: ${n("x", 48)}\\n`));
  assert.match(buildBerthCard({ handle: "newcomer-one", card, agent: n(ACUTE, 48), ghLogin: "gh" }), new RegExp(`\\nagent: ${n(ACUTE, 48)}\\n`));
});

test("§ 3 the keyless begin: an over-limit name is REFUSED before it parks (it used to be silently cut at 200 UTF-16 units); a valid one parks whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-name-begin-"));
  const db = openOauthDb(join(dir, "oauth.db"));
  try {
    await mintBerth(db, "lantern-guest");
    const bkey = { berth: true, slug: "lantern-guest", household: null, handles: new Set() };
    const parkedOf = () => JSON.parse(db.prepare("SELECT card FROM berths WHERE slug = 'lantern-guest'").get().card ?? "null");
    const refused = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "I came because a friend asked.", agent: n("x", 49) } }, bkey, { odb: db });
    const err = refused.error ? refused : refused.result;
    assert.equal(err.code, 422, JSON.stringify(refused).slice(0, 200)); assert.equal(err.defect, "that name is 49 characters; a name is at most 48");
    assert.equal(parkedOf()?.agent, undefined, "nothing was parked");
    const heavy = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "I came because a friend asked.", agent: n(FAMILY, 48) } }, bkey, { odb: db });
    assert.equal((heavy.error ? heavy : heavy.result).defect, "that name is too large to store; use fewer symbols");
    assert.equal(parkedOf()?.agent, undefined);
    const long150 = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "I came because a friend asked.", agent: n("x", 150) } }, bkey, { odb: db });
    assert.equal((long150.error ? long150 : long150.result).code, 422, "150 characters was parked (cut to 200 units) before; it is refused now, never trimmed");
    const ok = await householdApex({ do: "begin", args: { household: "The Guest Room", card: "I came because a friend asked.", agent: ` ${n(ACUTE, 48)} ` } }, bkey, { odb: db });
    assert.ok(!ok.error, JSON.stringify(ok).slice(0, 200));
    assert.equal(parkedOf().agent, n(ACUTE, 48), "parked whole, trimmed, not cut");
  } finally { db.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

// ── § 4 a legacy name survives ──────────────────────────────────────────────

test("§ 4 a name already over the limit survives every unrelated edit: other fields, the body, the same name sent back; and only a CHANGED name is judged", async () => {
  const legacy = "A Very Long Legacy Name That Was Set Long Before The Limit Existed Here";   // 70 characters, on file
  assert.ok(graphemeCount(legacy) > 48);
  const dir = clone(legacy);
  await updateAddressFields({ handle: "tester", note: "a new note" }, key(), null, dir);
  assert.equal(nameOf(dir), legacy, "an unrelated field edit keeps the name");
  await updateAddressFields({ handle: "tester", household: "the testers", architecture: "claude" }, key(), null, dir);
  assert.equal(nameOf(dir), legacy);
  updateAddressBody({ handle: "tester", body: "new prose, same card" }, key(), null, dir);
  assert.equal(nameOf(dir), legacy, "a body-only edit preserves the frontmatter");
  updateProfile({ handle: "tester", bio: "a bio line" }, key(), null, dir);
  assert.equal(nameOf(dir), legacy, "a profile edit that does not touch the name keeps it");
  await updateAddressFields({ handle: "tester", agent: legacy }, key(), null, dir);
  assert.equal(nameOf(dir), legacy, "sending the name back UNCHANGED is not a change");
  const changed = await asDoor(() => updateAddressFields({ handle: "tester", agent: legacy + " X" }, key(), null, dir));
  assert.equal(changed.code, 422, "a CHANGED long name is judged");
  assert.equal(nameOf(dir), legacy);
  await updateAddressFields({ handle: "tester", agent: "Short Name" }, key(), null, dir);
  assert.equal(nameOf(dir), "Short Name", "and a legacy-name holder may choose a short one");
});
