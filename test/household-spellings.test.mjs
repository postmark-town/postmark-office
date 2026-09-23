// household-spellings.test.mjs — A HOUSE HAS A SPELLING SET, AND THE STORE
// NEVER RESPELLS A ROW (postmark POS-160, w40 · RULING 4, PROVISIONAL).
//
//   node --test test/household-spellings.test.mjs
//
// ── WHAT WAS TRIED FIRST, AND WHY IT CANNOT BE ──────────────────────────────
//
// POS-160 made the household key the house's SLUG, and 007's draft row policy
// is a STRING EQUALITY, so a resident whose rows were written under `gh:<id>`
// stopped seeing their own drafts. `022_household_respell.sql` was going to
// re-spell the rows. THE STORE REFUSES THAT, measured on the dev sandbox
// 2026-09-22 (Wright's hand, a real Postgres), by three separate guards:
// `acts_append_only`, `claims_update_guard` (`NEW.household IS NOT DISTINCT
// FROM OLD.household` on every lawful transition) and `marks_id_is_fixed`.
//
// So the fix is on the READ side: a house declares every spelling it has ever
// carried, and the policy and every household filter compare against the set.
//
// ── THIS FILE IS NOT POSTGRES, AND SAYS SO IN EVERY ASSERTION ───────────────
//
// There is no store here. `024_household_spellings.sql`'s policy is SIMULATED,
// as the predicate it is — and the simulation is BUILT FROM THE MIGRATION'S OWN
// TEXT (`predicateFrom` below), not written out a second time beside it. That
// is the whole reason it can be flipped: revert the SQL to the single key and
// the JS predicate this file evaluates changes with it, and the three-spellings
// falsifier reds without a line of this file moving.
//
// WHAT IT THEREFORE DOES NOT PROVE: that Postgres parses the SQL, that
// `string_to_array` splits the way `splitKeys` splits, that `= ANY` over a text
// array behaves as `Array.includes` does, or that RLS is enabled on the table at
// all. Wright runs the real policy on the dev sandbox — the migration's § HOW TO
// PROVE IT LANDED carries the probe, as `office_api`, with a BEFORE count.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { houseKeysOf, sessionKeysFor, sessionKeyString, resolveHouse } from "../src/household-deriver.mjs";
import { heldParcelsByCred, credOf, parcelCapRefusals, parcelCapLawAt } from "../world2/tools/parcel-cap.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const REGISTRY = JSON.parse(readFileSync(join(FIX, "households.json"), "utf8"));
const PINS = JSON.parse(readFileSync(join(FIX, "github-ids.json"), "utf8"));
const SCHEMA = join(ROOT, "world2", "schema");
const SQL_024 = readFileSync(join(SCHEMA, "024_household_spellings.sql"), "utf8");

// Asserted rather than computed, so a fixture swapped for a smaller one cannot
// quietly make every count below trivially true. Same numbers
// `household-deriver.test.mjs` pins.
const LIVE = { households: 118, pins: 190 };

// ── THE HOUSE WITH THREE SPELLINGS ──────────────────────────────────────────
//
// `cadaeic.space` holds TWO GitHub accounts in the live registry, so it wears
// three keys: its slug key and one `gh:<id>` per account. It is the real shape
// the whole ruling is about — one family, filed under several names because the
// world repo's copy of the pins re-keyed one resident and not the others.
const HOUSE = "cadaeic.space";

// ═══════════════════════════════════════════════════════════════════════════
// 024'S POLICY, BUILT FROM 024'S OWN TEXT
// ═══════════════════════════════════════════════════════════════════════════

/** One `ALTER POLICY <name> ON claims …;` statement, comments stripped. */
function policyText(sql, name) {
  const bare = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const at = bare.indexOf(`ALTER POLICY ${name} ON claims`);
  assert.notEqual(at, -1, `024_household_spellings.sql carries no ALTER POLICY for ${name}`);
  const end = bare.indexOf(";", at);
  assert.notEqual(end, -1, `${name}'s statement in 024 is unterminated`);
  return bare.slice(at, end);
}

/** `string_to_array(NULLIF(<setting>, ''), ',')` — the split, in JS. */
const splitKeys = (setting) =>
  (setting == null || setting === "") ? null : String(setting).split(",");

// The two shapes this file knows how to evaluate. THE SECOND IS 007's, kept
// here on purpose: it is what the flip reverts to, and a flip that reverted to
// a shape this file could not read would throw rather than RED, which is a
// different outcome wearing the same colour.
const SET_FORM = /household = ANY\(string_to_array\(NULLIF\(current_setting\('app\.household_keys', true\), ''\), ','\)\)/;
const ONE_KEY_FORM = /household = current_setting\('app\.household', true\)/;

/**
 * The policy's predicate, as a JS function of `(row, session)`, READ OUT OF THE
 * MIGRATION rather than written down beside it.
 *
 * `session` is `{ household, household_keys }` — the two `set_config` values
 * `world2-claims.mjs § withHousehold` puts on the connection. An undeclared
 * setting is `null`, which is what `current_setting(…, true)` answers.
 */
function predicateFrom(statement, { draftsOnly = false } = {}) {
  const set = SET_FORM.test(statement);
  const one = ONE_KEY_FORM.test(statement);
  assert.ok(set || one,
    `this statement compares household in a shape the simulation does not know:\n${statement}`);
  assert.ok(!(set && one), "a policy carrying BOTH shapes is half-flipped; the simulation would pick one arbitrarily");

  const mine = (row, s) => (set
    ? (splitKeys(s?.household_keys) ?? []).includes(row.household)
    : (s?.household != null && row.household === s.household));

  return draftsOnly
    ? (row, s) => row.status === "draft" && mine(row, s)     // claims_delete_own_draft
    : (row, s) => row.status !== "draft" || mine(row, s);    // the other three
}

const claimsRead = predicateFrom(policyText(SQL_024, "claims_read"));
const claimsDelete = predicateFrom(policyText(SQL_024, "claims_delete_own_draft"), { draftsOnly: true });

/** The session `withHousehold` declares for `key`, as the two settings. */
const sessionFor = (key) => {
  const keys = sessionKeysFor(key, REGISTRY, PINS);
  return { household: key, household_keys: sessionKeyString(keys) };
};

test("the fixture is the live registry, not a toy", () => {
  assert.equal(Object.keys(REGISTRY.households).length, LIVE.households);
  assert.equal(Object.keys(PINS).length, LIVE.pins);
  assert.equal((REGISTRY.households[HOUSE]?.accounts ?? []).length, 2,
    `${HOUSE} still holds two accounts — the three-spellings falsifier below is built on that`);
});

// ═══════════════════════════════════════════════════════════════════════════
// FALSIFIER 1 · `houseKeysOf` ON THE REAL FIXTURE
// ═══════════════════════════════════════════════════════════════════════════

test("FALSIFIER 1 · the slug key is FIRST, and every account's `gh:` key is in the set", () => {
  const H = REGISTRY.households;
  let keys = 0;
  const seen = { hh: 0, gh: 0, other: 0 };

  for (const slug of Object.keys(H)) {
    // The PREFIXED key, deliberately: `resolveHouse` reads a bare string as a
    // HANDLE first, because three live handles are also some house's slug
    // (`mari`, `moth`, `elias-returning`). That ordering is the deriver's and
    // this function inherits it — asking with `hh:` is asking unambiguously.
    const ks = houseKeysOf(`hh:${slug}`, REGISTRY, PINS);
    assert.equal(ks[0], `hh:${slug}`, `${slug}: the live key must come first`);
    assert.equal(new Set(ks).size, ks.length, `${slug}: the set carries a duplicate`);
    for (const id of (H[slug].accounts ?? []).map((a) => a?.id).filter((x) => x != null))
      assert.ok(ks.includes(`gh:${id}`), `${slug}: the account gh:${id} is not in its own house's set`);
    keys += ks.length;
    for (const k of ks) seen[k.split(":")[0] in seen ? k.split(":")[0] : "other"]++;
  }

  // MEASURED 2026-09-22 on the town's own two files. Stated as numbers so a
  // fixture that quietly loses its second accounts reds here.
  assert.deepEqual({ keys, ...seen }, { keys: 239, hh: 118, gh: 121, other: 0 });
});

test("FALSIFIER 1b · every spelling of one house answers with the SAME set", () => {
  const want = houseKeysOf(`hh:${HOUSE}`, REGISTRY, PINS);
  assert.equal(want.length, 3, `${HOUSE} wears three spellings`);
  for (const spelling of want)
    assert.deepEqual(houseKeysOf(spelling, REGISTRY, PINS), want,
      `asked as ${spelling}, the house answered a different set`);
  // And through a resident's handle, which is what `householdKeyFor` is handed.
  assert.deepEqual(houseKeysOf(REGISTRY.households[HOUSE].residents[0], REGISTRY, PINS), want);
});

test("FALSIFIER 1c · a `formerly` entry rides in as `hh:<old>`, in either spelling it was stored", () => {
  // The fixture cannot supply one: POS-158 shipped the column and no door has
  // reached it yet, so 0 of 118 houses carry an alias. These rows are synthetic
  // and say so — the same note `household-deriver.test.mjs` carries.
  const withAlias = {
    households: {
      ...REGISTRY.households,
      [HOUSE]: { ...REGISTRY.households[HOUSE], formerly: ["the-old-name", "hh:older-still"] },
    },
  };
  assert.deepEqual(houseKeysOf(`hh:${HOUSE}`, withAlias, PINS), [
    `hh:${HOUSE}`, "hh:the-old-name", "hh:older-still",
    ...REGISTRY.households[HOUSE].accounts.map((a) => `gh:${a.id}`),
  ]);
});

test("FALSIFIER 1d · `solo:`, `login:` and an unknown name get NO set, and a session gets its own key anyway", () => {
  // `solo:<handle>` names no house — `resolveHouse`'s own law, and 022's map
  // excluded it in the same words. Admitting it would WIDEN: a `solo:` row was
  // written when the registry had never heard of that handle.
  assert.deepEqual(houseKeysOf("solo:wren-winter", REGISTRY, PINS), []);
  assert.deepEqual(houseKeysOf("login:crowandclock", REGISTRY, PINS), []);
  assert.deepEqual(houseKeysOf("nobody-at-all", REGISTRY, PINS), []);

  // But the SESSION always declares the key it is acting under, first. A
  // `solo:` session declaring `[]` would see none of its own drafts, which is a
  // regression on the string equality rather than the fix for it.
  assert.deepEqual(sessionKeysFor("solo:wren-winter", REGISTRY, PINS), ["solo:wren-winter"]);
  assert.deepEqual(sessionKeysFor("nobody-at-all", REGISTRY, PINS), ["nobody-at-all"]);
  // And a known house's session is the key plus its history, the key still first.
  assert.deepEqual(sessionKeysFor(`hh:${HOUSE}`, REGISTRY, PINS), houseKeysOf(`hh:${HOUSE}`, REGISTRY, PINS));
});

test("FALSIFIER 1e · NO BARE SPELLING is ever admitted — a set has no order to disambiguate one", () => {
  // `mari` is a resident of `starforge` AND the slug of another house. The
  // ordered walk reads it as a handle first; `= ANY(set)` cannot, so a bare
  // string in any set would be a cross-household match with nothing to say so.
  for (const slug of Object.keys(REGISTRY.households))
    for (const k of houseKeysOf(`hh:${slug}`, REGISTRY, PINS))
      assert.match(k, /^(hh|gh):/, `${slug} admitted the unprefixed spelling ${JSON.stringify(k)}`);

  assert.equal(resolveHouse("mari", REGISTRY, PINS).slug, "starforge",
    "the live collision is still live — if this moves, the paragraph above needs re-measuring");
});

test("FALSIFIER 1f · a key carrying a comma is REFUSED, because the session key is comma-joined", () => {
  const forged = { households: { ...REGISTRY.households, "a,b": { accounts: [], residents: [], formerly: [] } } };
  assert.throws(() => houseKeysOf("hh:a,b", forged, PINS), /carries a comma/);
  assert.throws(() => sessionKeysFor("solo:a,b", REGISTRY, PINS), /carries a comma/);
  // And the join is what the migration splits on, so the two must agree.
  assert.equal(sessionKeyString(["hh:x", "gh:1"]), "hh:x,gh:1");
  assert.equal(sessionKeyString([]), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// FALSIFIER 2 · THE POLICY, SIMULATED — three drafts, three spellings, one house
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚑ THE STUB IS NOT POSTGRES. See this file's header. The predicate below is
//   read out of 024's own text; everything around it is JS.

/** One draft per spelling — the store the three guards refuse to re-spell. */
const threeDrafts = () =>
  houseKeysOf(`hh:${HOUSE}`, REGISTRY, PINS)
    .map((hh, i) => ({ id: `draft-${i}`, slug: `${HOUSE}/sketch-${i}`, status: "draft", household: hh }));

const PUBLIC_ROW = { id: "docket-1", slug: "somebody/a-pending-claim", status: "pending", household: "hh:starforge" };

test("FALSIFIER 2 · the author's session sees ALL THREE of its drafts through the policy", () => {
  const rows = threeDrafts();
  assert.equal(new Set(rows.map((r) => r.household)).size, 3, "three distinct spellings, or this proves nothing");

  const s = sessionFor(`hh:${HOUSE}`);
  const seen = rows.filter((r) => claimsRead(r, s));
  assert.equal(seen.length, 3,
    `the author's session saw ${seen.length} of its own 3 drafts. The store never re-spells a row (three guards ` +
    `refuse it), so a policy comparing ONE key leaves the rest of this house's compose space unreadable to it.`);
  assert.deepEqual(seen.map((r) => r.household).sort(), rows.map((r) => r.household).sort());

  // And the SAME session may delete any of them — 007 built four policies over
  // one predicate, and the defect was phrased in its own words: "all four
  // policies compare the same string."
  assert.equal(rows.filter((r) => claimsDelete(r, s)).length, 3);
  assert.equal(claimsDelete(PUBLIC_ROW, s), false, "a public claim is never deletable, whatever the set says");
});

test("FALSIFIER 2b · a STRANGER's session sees none of them, and the docket stays public to everyone", () => {
  const rows = threeDrafts();

  const stranger = sessionFor("hh:starforge");
  assert.notEqual(stranger.household_keys, sessionFor(`hh:${HOUSE}`).household_keys);
  assert.deepEqual(rows.filter((r) => claimsRead(r, stranger)), [],
    "a house declaring its OWN spellings reached another house's drafts — the set widened past one house");
  assert.deepEqual(rows.filter((r) => claimsDelete(r, stranger)), []);

  // A spectator that declared nothing: `current_setting(…, true)` is NULL, the
  // split is NULL, `= ANY(NULL)` is NULL. 007's "a public read compares against
  // NULL, which is never equal to anything", preserved exactly.
  const nobody = { household: null, household_keys: null };
  assert.deepEqual(rows.filter((r) => claimsRead(r, nobody)), []);

  // THE EMPTY-STRING ROAD, which is why the migration carries `NULLIF`. Without
  // it `string_to_array('', ',')` is `{""}` — a one-element array holding the
  // empty string — and a row whose household is `''` would be visible to a
  // session that declared nothing at all.
  const blank = { household: "", household_keys: "" };
  assert.deepEqual([...rows, { id: "x", slug: "x/y", status: "draft", household: "" }]
    .filter((r) => claimsRead(r, blank)), []);

  // And the docket is public to every one of them, unchanged by this migration.
  for (const s of [stranger, nobody, blank, sessionFor(`hh:${HOUSE}`)])
    assert.equal(claimsRead(PUBLIC_ROW, s), true, "024 must not narrow the public docket for anyone");
});

test("FALSIFIER 2c · all four policies carry the set, and 024 leaves the other two alone", () => {
  for (const name of ["claims_read", "claims_insert", "claims_update_office", "claims_delete_own_draft"]) {
    const statement = policyText(SQL_024, name);
    assert.match(statement, SET_FORM, `${name} does not compare against app.household_keys`);
    assert.doesNotMatch(statement, ONE_KEY_FORM, `${name} still carries 007's single-key equality`);
  }
  // THE UPDATE'S WITH CHECK IS COMPULSORY, not tidy: `claims_update_guard`
  // requires `NEW.household IS NOT DISTINCT FROM OLD.household`, so composing a
  // `gh:`-spelled draft leaves it `gh:`-spelled. A narrow WITH CHECK would
  // refuse the write the widened USING just admitted.
  const upd = policyText(SQL_024, "claims_update_office");
  assert.equal([...upd.matchAll(new RegExp(SET_FORM.source, "g"))].length, 2,
    "claims_update_office must carry the set on BOTH its USING and its WITH CHECK");

  const bare = SQL_024.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(bare, /ALTER POLICY claims_update_clearing/, "the candle compares no household; 024 has no business there");
  assert.doesNotMatch(bare, /ALTER POLICY claims_read_stance/, "023's named carve is `USING (true)` and stays that way");
  assert.doesNotMatch(bare, /\bGRANT\b/, "024 grants nothing — 003's lawful enumeration must not need a row for it");

  // 003's DRAFT-CARVE falsifier looks for a SELECT policy on `claims` whose
  // qual does NOT carry `app.household`. `app.household_keys` contains that
  // string, so `claims_read` stays off the carve list — which is the correct
  // answer and not a near miss, so it is asserted rather than assumed.
  assert.ok("app.household_keys".includes("app.household"),
    "003_falsifier_roles.sql narrows on `qual NOT LIKE '%app.household%'`; if the setting is ever renamed off that " +
    "prefix, `claims_read` becomes an unlisted draft carve and the roles falsifier reds on the box");
});

// ═══════════════════════════════════════════════════════════════════════════
// FALSIFIER 3 · THE PARCEL CAP COUNTS THREE SPELLINGS AS ONE HOUSE
// ═══════════════════════════════════════════════════════════════════════════

const law = await parcelCapLawAt(WORLD_CLONE);
const resolve = (hh) => resolveHouse(hh, REGISTRY, PINS).slug;

/** A `q` that answers `heldParcelsByCred`'s one GROUP BY with the rows given. */
const groupedAs = (rows) => async () => ({ rows });

test("FALSIFIER 3 · one parcel under each of three spellings is ONE house at the cap, and the fourth is refused", async () => {
  const spellings = houseKeysOf(`hh:${HOUSE}`, REGISTRY, PINS);
  assert.equal(spellings.length, 3);
  assert.equal(law.cap, 3, "this falsifier is built on a cap of 3 — re-read it if the world's number moved");

  const held = await heldParcelsByCred(groupedAs(spellings.map((h) => ({ household: h, n: 1 }))), { resolve });
  assert.equal(held.size, 1, `three spellings of ${HOUSE} folded to ${held.size} households, not 1`);
  assert.equal(held.get(`hh:${HOUSE}`), 3, "the three parcels must count as three held by ONE house");

  const fourth = {
    id: `${HOUSE}/a-fourth-parcel`, slug: `${HOUSE}/a-fourth-parcel`,
    // The candidate side folds by the SAME rule. `ownerHouseholdFor` would hand
    // over whichever spelling `identities` holds for this claimant.
    cred: credOf(`gh:${REGISTRY.households[HOUSE].accounts[1].id}`, resolve),
    date: "2026-09-15", amending: false,
  };
  const v = parcelCapRefusals([fourth], { heldByCred: held, law });
  assert.equal(v.refused.length, 1,
    "the fourth parcel was ADMITTED. Unfolded, the three spellings count as three households holding one each, the " +
    "candle grants the claim with a receipt saying it was lawful, and the sweep refuses it twelve hours later — " +
    "POS-98 box 4's gap, re-opened by a spelling.");
  assert.equal(v.refused[0].held, 3);
  assert.match(v.refused[0].check, new RegExp(`cap ${law.cap} per household, ruled ${law.lawDate}`));
});

test("FALSIFIER 3b · THE CONTROL — unfolded, the same store admits the fourth, which is the defect", async () => {
  // `resolve` omitted is the pre-024 answer: counts per RAW SPELLING. Asserted
  // rather than described, so "the fold matters" is a measurement.
  const spellings = houseKeysOf(`hh:${HOUSE}`, REGISTRY, PINS);
  const raw = await heldParcelsByCred(groupedAs(spellings.map((h) => ({ household: h, n: 1 }))));
  assert.equal(raw.size, 3);
  const v = parcelCapRefusals([{ id: "x", slug: `${HOUSE}/a-fourth-parcel`, cred: spellings[1], date: "2026-09-15" }],
    { heldByCred: raw, law });
  assert.deepEqual(v.refused, [], "unfolded, the cap lets a fourth parcel through — that is what FALSIFIER 3 closes");
});

test("FALSIFIER 3c · a household the deriver cannot name keeps its own string and is folded with nothing", async () => {
  // A `solo:` row is genuinely its own house, and a row the map cannot name is
  // a row a PERSON should look at — 022's own words, and the refuse-rather-than-
  // guess rule. Folding either into a house would be the fabricated household.
  const held = await heldParcelsByCred(groupedAs([
    { household: `hh:${HOUSE}`, n: 1 },
    { household: "solo:wren-winter", n: 2 },
    { household: "an-unnameable-string", n: 1 },
  ]), { resolve });
  assert.deepEqual([...held.entries()].sort(),
    [[`hh:${HOUSE}`, 1], ["an-unnameable-string", 1], ["solo:wren-winter", 2]].sort());
});

// ═══════════════════════════════════════════════════════════════════════════
// FALSIFIER 4 · 022 IS RETIRED, AND THE MIGRATION LINT IS STILL GREEN
// ═══════════════════════════════════════════════════════════════════════════

test("FALSIFIER 4 · 022 keeps its name, writes nothing, and says why", () => {
  const raw = readFileSync(join(SCHEMA, "022_household_respell.sql"), "utf8");
  const bare = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();

  assert.equal(bare, "SELECT 1;",
    "022 is retired to a header and `SELECT 1;` — anything else here is a statement the three guards refuse");

  // The header must still carry the reason, or the next reader re-derives it.
  for (const must of ["acts_append_only", "claims_update_guard", "marks_id_is_fixed", "024_household_spellings.sql"])
    assert.ok(raw.includes(must), `022's retirement header no longer names ${must}`);

  // AND THE LINT IT USED TO BREAK. `registry-grants.test.mjs` parses every file
  // in the directory for a write to `acts`; this asserts the retired file is
  // clean of all three verbs rather than trusting the sibling suite ran.
  for (const re of [/\bUPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?"?acts"?\b/i,
                    /\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:public\s*\.\s*)?"?acts"?\b/i,
                    /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(?:public\s*\.\s*)?"?acts"?\b/i])
    assert.doesNotMatch(bare, re);
});

test("FALSIFIER 4b · 024 writes no row either — the store never respells, by anything", () => {
  const bare = SQL_024.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const verb of [/\bUPDATE\s+claims\b/i, /\bUPDATE\s+marks\b/i, /\bUPDATE\s+acts\b/i,
                      /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i])
    assert.doesNotMatch(bare, verb,
      "024 is a POLICY migration. A row it moved would meet the same three guards 022 met.");
  // Its one UPDATE is the registry's own ruling line, which is not a store row.
  assert.match(bare, /UPDATE registry SET ruling/);
});
