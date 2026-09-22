// registry-rows.test.mjs — THE ROUND-TRIP LAW, proven on the real files (POS-187).
//
// The household registry becomes store-of-record in 019_households.sql. The
// one thing that makes that safe is this law:
//
//     renderRegistry(rowsFromRegistry(the two files)) === the two files,
//                                                        byte for byte
//
// `tools/registry-drain.mjs --check` enforces it on the box, against whatever
// the clone holds that morning, and its red is the whole flip stopping. This
// file enforces the SAME law here, on the town's REAL files as of 2026-09-22
// (origin/main df732534a) — 118 households and 190 pins, copied byte-exact
// into test/fixtures/registry-2026-09-22/ and pinned to LF by .gitattributes'
// own `test/fixtures/** text eol=lf` guard, which exists for exactly this
// reason.
//
// A fixture of three invented houses would prove the code composes with
// itself. These are the town's own bytes, with every shape the live registry
// actually wears: a house with no `name`, a house with no `human`, a house with
// `member_of`, two path-hostile slugs, two accounts on one house, 12 pins with
// no `pinned` date, and pins carrying `renamed`, `note`, `retired` and
// `renamed_to`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  rowsFromRegistry, renderRegistry, registryFromRows, pinsFromRows,
  firstDifferingLine, HOUSEHOLD_KEYS, PIN_KEYS,
} from "../src/registry-rows.mjs";
import { houseForAccount, houseForName, serializeRegistry, serializePins } from "../src/residency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");

const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");
const HOUSEHOLDS = JSON.parse(HOUSEHOLDS_RAW);
const PINS = JSON.parse(PINS_RAW);

// The counts this lane measured and the PR's INSTALL block quotes. They are
// asserted rather than computed so that a fixture swapped for a smaller one
// cannot quietly make every count-based assertion below trivially true.
const LIVE = { households: 118, pins: 190 };

/**
 * The rows as POSTGRES WOULD HAND THEM BACK, not as JavaScript built them.
 *
 * This is the whole point of the reader half. `node-postgres` returns a
 * `bigint` column as a STRING — it will not silently narrow one to a float —
 * and the file spells a pin's `id` as a NUMBER. A test that fed hand-built rows
 * straight back into the renderer would never meet that, and the first real
 * `--check` on the box would red on 190 lines at once. `ord` comes back as a
 * number from int4 and `accounts` comes back parsed from jsonb, so those are
 * passed through as they are.
 */
const asPostgresReturns = (rows) => ({
  meta: rows.meta,
  households: rows.households.map((r) => ({ ...r, ord: Number(r.ord) })),
  pins: rows.pins.map((r) => ({ ...r, gh_id: String(r.gh_id) })),
});

test("THE LAW: the store's rendering of the town's real files is byte-equal to them", () => {
  const rows = rowsFromRegistry(HOUSEHOLDS, PINS);
  assert.equal(rows.households.length, LIVE.households, "118 households, as measured on origin/main df732534a");
  assert.equal(rows.pins.length, LIVE.pins, "190 pins, as measured on origin/main df732534a");

  const out = renderRegistry(asPostgresReturns(rows));

  assert.equal(firstDifferingLine(out.households, HOUSEHOLDS_RAW), null,
    "tools/households.json renders byte-for-byte from the rows");
  assert.equal(out.households, HOUSEHOLDS_RAW);
  assert.equal(firstDifferingLine(out.pins, PINS_RAW), null,
    "tools/github-ids.json renders byte-for-byte from the rows");
  assert.equal(out.pins, PINS_RAW);
});

test("the files are exactly what the town pen's own serializers write — there is no second spelling", () => {
  // If this reds, the premise the whole round trip rests on has moved: the
  // files are no longer `JSON.stringify(obj, null, 2) + "\n"`, and the renderer
  // is matching them by luck rather than by construction.
  assert.equal(serializeRegistry(HOUSEHOLDS), HOUSEHOLDS_RAW);
  assert.equal(serializePins(PINS), PINS_RAW);
  assert.ok(!HOUSEHOLDS_RAW.includes("\r"), "the registry blob is LF");
  assert.ok(!PINS_RAW.includes("\r"), "the pin blob is LF");
});

test("the household order is the file's own, and it is neither sorted nor dated", () => {
  // The reason `ord` is a column rather than a derivation. If either of these
  // ever became true, somebody could delete the column — and until then,
  // deleting it silently reorders 118 lines of the town's file.
  const slugs = Object.keys(HOUSEHOLDS.households);
  assert.notDeepEqual(slugs, [...slugs].sort(), "the file is NOT in slug order");
  const sinces = slugs.map((s) => HOUSEHOLDS.households[s].since);
  assert.notDeepEqual(sinces, [...sinces].sort(), "the file is NOT in `since` order either");

  // …and the renderer restores it from `ord` alone, not from the query's order.
  const rows = rowsFromRegistry(HOUSEHOLDS, PINS);
  const shuffled = { ...rows, households: [...rows.households].reverse() };
  assert.deepEqual(Object.keys(registryFromRows(shuffled).households), slugs,
    "rows arriving in any order render in the file's order");
});

test("the pin order IS derived — the file is sorted by handle and the renderer sorts", () => {
  const handles = Object.keys(PINS);
  assert.deepEqual(handles, [...handles].sort(), "the live pin file is sorted");
  const rows = rowsFromRegistry(HOUSEHOLDS, PINS);
  const shuffled = { ...rows, pins: [...rows.pins].reverse() };
  assert.equal(renderRegistry(shuffled).pins, PINS_RAW, "rows arriving in any order render sorted");
});

test("an ABSENT key and a null are different things, on both files", () => {
  const rows = rowsFromRegistry(HOUSEHOLDS, PINS);
  const reg = registryFromRows(rows);

  // 5 of 118 houses have never said what they are called. `"name": null` in the
  // town's file would be both a lie and a diff, and the card's own word for
  // this is "(unstated — ask them)" (src/residency.mjs § A HOUSE OF ONE).
  const nameless = Object.entries(reg.households).filter(([, r]) => !("name" in r));
  assert.equal(nameless.length, 5);
  for (const [, r] of nameless) assert.ok(!Object.keys(r).includes("name"));

  // 12 of 190 pins carry no `pinned` date.
  const pins = pinsFromRows(rows);
  const undated = Object.entries(pins).filter(([, r]) => !("pinned" in r));
  assert.equal(undated.length, 12);
  for (const [, r] of undated) assert.ok(!Object.keys(r).includes("pinned"));
});

test("every live record's key order is a subsequence of the one template", () => {
  // What makes byte-equality reachable at all. A record that broke this would
  // render with its keys in a different order and the diff would be its whole
  // block — so this is the premise, asserted, rather than a comment.
  for (const [slug, rec] of Object.entries(HOUSEHOLDS.households)) {
    const keys = Object.keys(rec);
    assert.deepEqual(keys, HOUSEHOLD_KEYS.filter((k) => keys.includes(k)), `household ${slug}`);
  }
  for (const [handle, rec] of Object.entries(PINS)) {
    const keys = Object.keys(rec);
    assert.deepEqual(keys, PIN_KEYS.filter((k) => keys.includes(k)), `pin ${handle}`);
  }
});

test("a field the templates do not name REFUSES rather than renders without it", () => {
  // The failure this guard exists to stop: the town starts carrying a new
  // per-house field, the fold silently drops it, and the next drain commits a
  // file that has lost somebody's row content. It must stop at the seed.
  const doc = JSON.parse(HOUSEHOLDS_RAW);
  doc.households["fox-hearth"].motto = "we keep the fire";
  assert.throws(() => rowsFromRegistry(doc, PINS), /motto/,
    "an unknown household field names itself and stops the fold");

  const pins = JSON.parse(PINS_RAW);
  pins.alden.vouched_by = "corwin";
  assert.throws(() => rowsFromRegistry(HOUSEHOLDS, pins), /vouched_by/,
    "an unknown pin field names itself and stops the fold");
});

// ── the (a) readers' answers, from the table and from the file ──────────────
//
// The brief's condition on moving any door reader to the store: it must answer
// what it answered from the file. These are the two pure deciders every write
// path folds through (`planRegistryJoin` calls both), asked about three real
// houses chosen for their shapes:
//
//   cadaeic.space     no `name`, a `human`, TWO accounts, a dot in the slug
//   fox-hearth        `name` AND `human`, one account, a renamed login
//   casa-nera         `name`, no `human`, `member_of: the-harbor`
//
const PROBES = [
  { slug: "cadaeic.space", id: 306985727, login: "vertas-marginalia", names: ["cadaeic.space", "Cadaeic"] },
  { slug: "cadaeic.space", id: 314099683, login: "cadaeix-bot", names: ["cadaeic.space"] },
  { slug: "fox-hearth", id: 20786448, login: "fox-hearth", names: ["fox-hearth", "Fox Hearth", "Sydney"] },
  { slug: "casa-nera", id: 317614670, login: "creepitalism", names: ["casa-nera", "Casa Nera"] },
];

test("houseForAccount and houseForName answer identically from the table and from the file", () => {
  const fromFile = HOUSEHOLDS;
  const fromTable = registryFromRows(asPostgresReturns(rowsFromRegistry(HOUSEHOLDS, PINS)));

  for (const p of PROBES) {
    assert.equal(houseForAccount(fromFile, p.id, p.login), p.slug, `file: account ${p.id}`);
    assert.equal(houseForAccount(fromTable, p.id, p.login), p.slug, `table: account ${p.id}`);
    for (const n of p.names) {
      assert.equal(houseForName(fromFile, n), p.slug, `file: name "${n}"`);
      assert.equal(houseForName(fromTable, n), p.slug, `table: name "${n}"`);
    }
  }

  // And the negative, which is the half that actually matters at a door: an
  // account the town does not know must be unknown on BOTH roads. A store read
  // that answered a house here would hand a stranger somebody's household.
  assert.equal(houseForAccount(fromFile, 999_999_999, "nobody-at-all"), null);
  assert.equal(houseForAccount(fromTable, 999_999_999, "nobody-at-all"), null);
  assert.equal(houseForName(fromTable, "a house that does not exist"), null);
});

test("every one of the 118 houses answers the same on both roads, not just the three probes", () => {
  // The three above are readable; this one is exhaustive. Together they are the
  // brief's condition met for every row rather than for a sample.
  const fromTable = registryFromRows(asPostgresReturns(rowsFromRegistry(HOUSEHOLDS, PINS)));
  for (const [slug, rec] of Object.entries(HOUSEHOLDS.households)) {
    for (const a of rec.accounts ?? []) {
      assert.equal(houseForAccount(fromTable, a.id, a.login), houseForAccount(HOUSEHOLDS, a.id, a.login), `account ${a.login}`);
    }
    assert.equal(houseForName(fromTable, slug), houseForName(HOUSEHOLDS, slug), `slug ${slug}`);
    if (rec.name) assert.equal(houseForName(fromTable, rec.name), houseForName(HOUSEHOLDS, rec.name), `name ${rec.name}`);
    if (rec.human) assert.equal(houseForName(fromTable, rec.human), houseForName(HOUSEHOLDS, rec.human), `human ${rec.human}`);
  }
});

test("the two path-hostile slugs the seed grandfathers are still in the fold", () => {
  // Named in 019's header as the reason there is no slug-alphabet CHECK in SQL.
  // If a CHECK is ever added upstream, this reds before the seed refuses on the
  // box at 05:45.
  const slugs = rowsFromRegistry(HOUSEHOLDS, PINS).households.map((r) => r.slug);
  assert.ok(slugs.includes("victor-b.-rose-e."), "victor-b.-rose-e. survives the fold");
  assert.ok(slugs.includes("cadaeic.space"), "cadaeic.space survives the fold");
});

test("firstDifferingLine names a line a person can go to", () => {
  // The probe must be able to fail, and its failure must be actionable.
  const a = "one\ntwo\nthree\n";
  assert.equal(firstDifferingLine(a, a), null);
  assert.deepEqual(firstDifferingLine(a, "one\nTWO\nthree\n"), { line: 2, rendered: "two", actual: "TWO" });
  assert.equal(firstDifferingLine(a, "one\ntwo\n").line, 3);
});
