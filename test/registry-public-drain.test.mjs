// registry-public-drain.test.mjs — the drain prints the PUBLIC registry: no private human name (POS-394).
//
// Darko 2026-10-05 / Wright 2026-10-12: the household's private human name is
// never printed where the public reads. The town repo's tools/households.json is
// public, so the drain's printout leaves each house's `human` KEY out; the store,
// the fold and the private render keep it.
//
// EVERYTHING HERE IS INVENTED, FROM FIXED LITERALS: three houses, four pins, two
// sentinel private names. The store is the suite's in-memory pool
// (test/registry-pool-stub.mjs), the clone is a temp directory, the pen is a
// capture. No database, network, town clone, real printout or dated fixture.
//
//   § 1  the public render: exact bytes, no human key, pins exact; the private render as control
//   § 2  checkRegistry against a public printout, a changed pin, a changed field, a private-bearing printout
//   § 3  drainRegistry writes the public printout once, then is a no-op; the store is untouched
//   § 4  the guards: a missing house or pin writes nothing, a rename is not a deletion, no store is refused
//   § 5  the named list (POS-726): the printout carries only named fields; the private render keeps the rest
//   § 6  the FIX round (POS-726): home_images and accounts printed in their declared shapes

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { rowsFromRegistry, renderRegistry, renderPublicRegistry } from "../src/registry-rows.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { checkRegistry, drainRegistry } from "../tools/registry-drain.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

after(() => __setPoolForTest(null));

const PRIVATE_SENTINEL = "PRIVATE_SENTINEL_d8rn_human";
const PRIVATE_SENTINEL_2 = "PRIVATE_SENTINEL_w3fj_human";
const leaks = (s) => String(s).includes(PRIVATE_SENTINEL) || String(s).includes(PRIVATE_SENTINEL_2);

// The store: one named house with a private human, one house with NO display
// name and a private human, one named house with no human (its column is NULL).
const REGISTRY = { schema_version: 1, note: "invented for the POS-394 drain", households: {
  "salt-lantern": { name: "Salt Lantern", human: PRIVATE_SENTINEL, accounts: [{ login: "sl-gh", id: 9501 }],
    residents: ["brine", "cork"], since: "2026-08-10", declared_by: "brine" },
  "quiet-mill": { human: PRIVATE_SENTINEL_2, accounts: [{ login: "qm-gh", id: 9502 }],
    residents: ["reed"], since: "2026-08-11", declared_by: "reed" },
  "open-door": { name: "Open Door", accounts: [{ login: "od-gh", id: 9503 }],
    residents: ["wren"], since: "2026-08-12", member_of: "the-harbor", declared_by: "wren" },
} };
const PINS = {
  brine: { login: "sl-gh", id: 9501, pinned: "2026-08-10" }, cork: { login: "sl-gh", id: 9501 },
  reed: { login: "qm-gh", id: 9502 }, wren: { login: "od-gh", id: 9503, note: "a pin note" },
};
const ROWS = () => rowsFromRegistry(REGISTRY, PINS);

// What the public printout must be, written out by hand: every key in the file's
// template order, no `human` anywhere, two-space JSON and one trailing newline.
const PUBLIC_RAW = JSON.stringify({ schema_version: 1, note: "invented for the POS-394 drain", households: {
  "salt-lantern": { name: "Salt Lantern", accounts: [{ login: "sl-gh", id: 9501 }], residents: ["brine", "cork"], since: "2026-08-10", declared_by: "brine" },
  "quiet-mill": { accounts: [{ login: "qm-gh", id: 9502 }], residents: ["reed"], since: "2026-08-11", declared_by: "reed" },
  "open-door": { name: "Open Door", accounts: [{ login: "od-gh", id: 9503 }], residents: ["wren"], since: "2026-08-12", member_of: "the-harbor", declared_by: "wren" },
} }, null, 2) + "\n";
const PINS_RAW = JSON.stringify({
  brine: { login: "sl-gh", id: 9501, pinned: "2026-08-10" }, cork: { login: "sl-gh", id: 9501 },
  reed: { login: "qm-gh", id: 9502 }, wren: { login: "od-gh", id: 9503, note: "a pin note" },
}, null, 2) + "\n";

function cloneWith(households, pins) {
  const dir = tempDir("pos394-drain-");
  mkdirSync(join(dir, "tools"), { recursive: true });
  if (households != null) writeFileSync(join(dir, REGISTRY_PATH), households);
  if (pins != null) writeFileSync(join(dir, PINS_PATH), pins);
  return dir;
}
const read = (clone, rel) => readFileSync(join(clone, rel), "utf8");

/** Run `fn` with the in-memory store seeded from `rows`; answers the pool. */
async function withStore(rows, fn) {
  const pool = makePool(rows);
  __setPoolForTest(pool);
  try { return await fn(pool); } finally { __setPoolForTest(null); }
}

// ── § 1 the public render ───────────────────────────────────────────────────

test("§ 1 the public render: exact bytes without the human key, pins exact; the private render still holds it", () => {
  const rows = ROWS();
  const before = JSON.stringify(rows);
  const pub = renderPublicRegistry(rows);
  assert.equal(pub.households, PUBLIC_RAW, "byte for byte: meta, names, accounts, members, order, newline");
  assert.equal(leaks(pub.households), false, "no private name");
  assert.equal(/"human"\s*:/.test(pub.households), false, "no human key in any house, named, nameless or null");
  assert.equal(pub.pins, PINS_RAW, "pins exact");
  assert.deepEqual(Object.keys(JSON.parse(pub.households)), ["schema_version", "note", "households"]);
  assert.equal(JSON.stringify(rows), before, "the rows handed in are unchanged");

  const priv = renderRegistry(rows);
  assert.equal(leaks(priv.households), true, "CONTROL: the private render still holds the names");
  assert.deepEqual(Object.entries(JSON.parse(priv.households).households).filter(([, h]) => "human" in h).map(([s]) => s),
    ["salt-lantern", "quiet-mill"], "CONTROL: the private render keeps the key where the store has a value (a NULL renders no key, as always)");
  assert.equal(priv.pins, pub.pins, "the two renders share one pins rendering");
  assert.equal(JSON.stringify(rows), before);
});

// ── § 2 the gate ────────────────────────────────────────────────────────────

test("§ 2 --check: a public printout is green; a changed pin, a changed field, or a printout that still carries the human is red", async () => {
  await withStore(ROWS(), async () => {
    const ok = await checkRegistry({ clone: cloneWith(PUBLIC_RAW, PINS_RAW), env: RECORD_ON });
    assert.equal(ok.ok, true, JSON.stringify(ok.diffs));
    assert.deepEqual(ok.diffs, []);

    const pin = await checkRegistry({ clone: cloneWith(PUBLIC_RAW, PINS_RAW.replace('"a pin note"', '"another note"')), env: RECORD_ON });
    assert.equal(pin.ok, false);
    assert.deepEqual(pin.diffs.map((d) => d.path), [PINS_PATH], "a pin that differs is a pins diff");

    const field = await checkRegistry({ clone: cloneWith(PUBLIC_RAW.replace('"Open Door"', '"Open Doors"'), PINS_RAW), env: RECORD_ON });
    assert.equal(field.ok, false);
    assert.deepEqual(field.diffs.map((d) => d.path), [REGISTRY_PATH]);

    // the printout as the OLD drain wrote it (private render): the gate is red, at a human line
    const old = await checkRegistry({ clone: cloneWith(renderRegistry(ROWS()).households, PINS_RAW), env: RECORD_ON });
    assert.equal(old.ok, false, "a printout carrying the private key is not the store's public printout");
    assert.deepEqual(old.diffs.map((d) => d.path), [REGISTRY_PATH]);
    assert.match(old.diffs[0].actual, /^\s*"human":/, "the first difference is the printout's human line (its value is not asserted or shown)");
    assert.equal(leaks(old.diffs[0].rendered), false, "and the store's side of the diff carries no private name");
  });
});

// ── § 3 the write ───────────────────────────────────────────────────────────

test("§ 3 --apply writes the public printout in one commit through the pen, then does nothing; the store is untouched", async () => {
  await withStore(ROWS(), async (pool) => {
    const storeBefore = JSON.stringify(pool.state);
    const clone = cloneWith("{}\n", "{}\n");
    const calls = [];
    const pen = (c, paths, message) => { calls.push({ c, paths, message }); return "c0ffee"; };

    const r = await drainRegistry({ clone, env: RECORD_ON, commit: pen });
    assert.equal(r.ran, true);
    assert.deepEqual([...r.changed].sort(), [PINS_PATH, REGISTRY_PATH].sort());
    assert.deepEqual(r.counts, { households: 3, pins: 4 });
    assert.equal(r.commit, "c0ffee");
    assert.equal(calls.length, 1, "one commit over both files");
    assert.equal(calls[0].paths.length, 2);
    assert.match(calls[0].message, /3 households, 4 pins/);
    assert.equal(leaks(calls[0].message), false);
    assert.equal(read(clone, REGISTRY_PATH), PUBLIC_RAW, "the PUBLIC printout, byte for byte");
    assert.equal(read(clone, PINS_PATH), PINS_RAW, "pins exact");

    const again = await drainRegistry({ clone, env: RECORD_ON, commit: pen });
    assert.deepEqual([again.ran, again.changed, again.commit], [true, [], null], "a repeat writes nothing");
    assert.equal(calls.length, 1, "and the pen is not asked");
    assert.equal(JSON.stringify(pool.state), storeBefore, "the store (with its private names) is untouched by the drain");
    assert.equal(leaks(JSON.stringify(pool.state.households)), true, "CONTROL: the store still holds the names");
  });
});

// ── § 4 the guards ──────────────────────────────────────────────────────────

test("§ 4 a house or pin the store lacks writes nothing; a rename is not a deletion; no store is refused", async () => {
  const pen = (calls) => (...a) => { calls.push(a); return "x"; };
  await withStore(ROWS(), async () => {
    // a house in the printout the store does not hold
    const extra = JSON.parse(PUBLIC_RAW);
    extra.households["a-hand-added-house"] = { accounts: [{ login: "x-gh", id: 9599 }], residents: ["x"], since: "2026-08-20", declared_by: "x" };
    const extraRaw = JSON.stringify(extra, null, 2) + "\n";
    const c1 = cloneWith(extraRaw, PINS_RAW);
    const calls = [];
    const r1 = await drainRegistry({ clone: c1, env: RECORD_ON, commit: pen(calls) });
    assert.equal(r1.ran, false);
    assert.deepEqual(r1.missing.households, ["a-hand-added-house"]);
    assert.equal(read(c1, REGISTRY_PATH), extraRaw, "nothing written");
    assert.equal(calls.length, 0, "nothing committed");
    // a pin the store does not hold
    const pins = JSON.parse(PINS_RAW);
    pins["zz-hand-pin"] = { login: "z-gh", id: 9598 };
    const c2 = cloneWith(PUBLIC_RAW, JSON.stringify(pins, null, 2) + "\n");
    const r2 = await drainRegistry({ clone: c2, env: RECORD_ON, commit: pen(calls) });
    assert.equal(r2.ran, false);
    assert.deepEqual(r2.missing.pins, ["zz-hand-pin"]);
    assert.equal(calls.length, 0);
  });

  // a rename: the store holds open-door as `open-house`, `formerly` naming the old key
  const renamed = ROWS();
  renamed.households = renamed.households.map((h) => (h.slug === "open-door" ? { ...h, slug: "open-house", formerly: ["open-door"] } : h));
  await withStore(renamed, async () => {
    const clone = cloneWith(PUBLIC_RAW, PINS_RAW);
    const calls = [];
    const r = await drainRegistry({ clone, env: RECORD_ON, commit: pen(calls) });
    assert.equal(r.refused, undefined, r.refused);
    assert.equal(r.ran, true);
    const printed = JSON.parse(read(clone, REGISTRY_PATH));
    assert.ok(printed.households["open-house"], "the new key is printed");
    assert.equal(printed.households["open-door"], undefined, "and the old key is not printed twice");
    assert.deepEqual(printed.households["open-house"].formerly, ["open-door"]);
    assert.equal(leaks(read(clone, REGISTRY_PATH)), false, "still no private name");
  });

  // no store: an office not pointed at the record renders and writes nothing
  const clone = cloneWith(PUBLIC_RAW, PINS_RAW);
  const calls = [];
  const d = await drainRegistry({ clone, env: {}, commit: pen(calls) });
  assert.equal(d.ran, false);
  assert.match(d.skipped, /not pointed at the record/);
  assert.equal(calls.length, 0);
  assert.equal(read(clone, REGISTRY_PATH), PUBLIC_RAW);
  const c = await checkRegistry({ clone, env: {} });
  assert.deepEqual([c.ok, c.unreachable], [false, true], "an un-run gate is not a pass");
});

// ── § 5 the named list (POS-726) ────────────────────────────────────────────
//
// LAW (Darko's picker answer on POS-845, 2026-11-03 05:53Z): the public line is a "Named list".
// Wright's hand-back on POS-726: only fields named public are sent; a new field is private until named.
//
// The sentinels reach the render through the real fold, and through the in-memory store the drain
// reads (jsonb keys come back re-sorted, as Postgres hands them): a scalar registry meta key, an
// unnamed key in an account, a likeness answer and an invitation, an object under a resident's handle
// in `home_images`, an object under the named house key `name`, and an object under the named pin key
// `note`. Invented houses, handles, logins and ids throughout.

const S726 = Object.freeze({
  meta: "SENT_P726_meta", account: "SENT_P726_account", likeness: "SENT_P726_likeness", invite: "SENT_P726_invite",
  image: "SENT_P726_image", underNamed: "SENT_P726_under_named", underPin: "SENT_P726_under_pin", human: "SENT_P726_human",
});
const leaks726 = (s) => Object.entries(S726).filter(([, v]) => String(s).includes(v)).map(([k]) => k).sort();
const IMG = "https://media.postmark.town/media/p726/pell.png";
const REG_726 = { schema_version: 1, note: "invented for POS-726", extra_meta: S726.meta, households: {
  "ember-loft": { name: "Ember Loft", human: S726.human, accounts: [{ login: "el-gh", id: 9811, secret: S726.account }],
    residents: ["pell", "otter-q"], since: "2026-09-01", declared_by: "pell",
    home_images: { pell: IMG, "otter-q": { url: IMG, secret: S726.image } },
    likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1", secret: S726.likeness },
    invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z", secret: S726.invite } },
  "tarn-yard": { name: { shown: "Tarn Yard", secret: S726.underNamed }, accounts: [{ login: "ty-gh", id: 9813 }],
    residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" },
} };
const PINS_726 = { pell: { login: "el-gh", id: 9811, pinned: "2026-09-01" }, "otter-q": { login: "el-gh", id: 9811 },
  tarn: { login: "ty-gh", id: 9813, pinned: "2026-09-02", note: { text: "n", secret: S726.underPin } } };

// The printout, written out by hand: named keys only, in the file's template order, two-space JSON, one newline.
const PUBLIC_726_RAW = JSON.stringify({ schema_version: 1, note: "invented for POS-726", households: {
  "ember-loft": { name: "Ember Loft", accounts: [{ login: "el-gh", id: 9811 }], residents: ["pell", "otter-q"],
    since: "2026-09-01", declared_by: "pell", home_images: { pell: IMG },
    likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1" },
    invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z" } },
  "tarn-yard": { accounts: [{ login: "ty-gh", id: 9813 }], residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" },
} }, null, 2) + "\n";
const PINS_726_RAW = JSON.stringify({ "otter-q": { login: "el-gh", id: 9811 }, pell: { login: "el-gh", id: 9811, pinned: "2026-09-01" },
  tarn: { login: "ty-gh", id: 9813, pinned: "2026-09-02" } }, null, 2) + "\n";

test("§ 5 the named list: the printout carries only named fields, byte for byte; the private render keeps the rest", () => {
  const rows = rowsFromRegistry(REG_726, PINS_726);
  const before = JSON.stringify(rows);
  const priv = renderRegistry(rows);
  assert.deepEqual(leaks726(priv.households + priv.pins), Object.keys(S726).sort(), "CONTROL: the private render still prints every sentinel");
  const pub = renderPublicRegistry(rows);
  assert.deepEqual(leaks726(pub.households + pub.pins), [], "no sentinel in the printout (the list names each one that is)");
  assert.equal(pub.households, PUBLIC_726_RAW, "households.json, byte for byte");
  assert.equal(pub.pins, PINS_726_RAW, "github-ids.json, byte for byte");
  assert.equal(JSON.stringify(rows), before, "the rows handed in are unchanged");
});

test("§ 5 the named list: the drain writes that printout from the store, and --check is green against it", async () => {
  await withStore(rowsFromRegistry(REG_726, PINS_726), async (pool) => {
    const storeBefore = JSON.stringify(pool.state);
    const clone = cloneWith("{}\n", "{}\n");
    const calls = [];
    const r = await drainRegistry({ clone, env: RECORD_ON, commit: (c, paths, message) => { calls.push(message); return "c0ffee"; } });
    assert.equal(r.ran, true, r.refused ?? r.skipped);
    assert.equal(read(clone, REGISTRY_PATH), PUBLIC_726_RAW, "the printout the drain wrote, byte for byte");
    assert.equal(read(clone, PINS_PATH), PINS_726_RAW);
    assert.deepEqual(leaks726(calls.join("\n")), [], "and nothing private in its commit message");
    const gate = await checkRegistry({ clone, env: RECORD_ON });
    assert.equal(gate.ok, true, JSON.stringify(gate.diffs));
    assert.equal(JSON.stringify(pool.state), storeBefore, "the store is untouched by the drain");
    assert.deepEqual(leaks726(JSON.stringify(pool.state)), Object.keys(S726).sort(), "CONTROL: the store still holds every sentinel");
  });
});

// ── § 6 the FIX round (POS-726) ─────────────────────────────────────────────
//
// LAW (Rivet's FIX brief on POS-726, 2026-11-03 17:58Z): "A named scalar is not a license for arbitrary
// keys/objects below it; lists/nested fields keep their existing DECLARED shapes." `home_images` is URL text
// under a resident's handle, on the house that resident stands in (registry-store.mjs § setHomeImage: "a
// picture can only ever land on the house the resident stands in at that moment"; registry-rows.mjs §
// homePictureIn: "Only an entry for one of THAT house's own residents counts, so a picture left behind when a
// resident moved house reads as none"). An account is an object in a list, cut to `login` and `id`.
//
// The bad entries reach the render through the real fold and through the in-memory store the drain reads.
// Invented houses, handles, logins, ids and URLs; `gone-wren` lives in odd-shed and left a picture on
// fen-hollow. The two numbers are sentinels too.

const S_FIX = Object.freeze({ left: "SENT_P726_left_behind", alone: "SENT_P726_left_alone", list: "SENT_P726_image_list",
  bare: "SENT_P726_bare_account", nested: "SENT_P726_nested_account", account: "SENT_P726_fix_account",
  num: "72600931", numAccount: "72600932", human: "SENT_P726_fix_human" });
const leaksFix = (s) => Object.entries(S_FIX).filter(([, v]) => String(s).includes(v)).map(([k]) => k).sort();
const media = (name) => `https://media.postmark.town/media/p726/${name}.png`;
const REG_FIX = { schema_version: 1, note: "invented for POS-726's FIX round", households: {
  "fen-hollow": { name: "Fen Hollow", human: S_FIX.human,
    accounts: [{ login: "fh-gh", id: 9821 }, S_FIX.bare, Number(S_FIX.numAccount), null, [{ login: S_FIX.nested, id: 9822 }],
      { login: "fh2-gh", id: 9823, secret: S_FIX.account }],
    residents: ["fen", "reed-b", "moss-c", "lark-d", "tern-e", "kit-f"], since: "2026-09-04", declared_by: "fen",
    home_images: { fen: IMG, "gone-wren": media(S_FIX.left), "reed-b": Number(S_FIX.num), "moss-c": true, "lark-d": null, "tern-e": "",
      "kit-f": [media(S_FIX.list)] } },
  "odd-shed": { name: "Odd Shed", accounts: [{ login: "os-gh", id: 9825 }], residents: ["shed", "gone-wren"], since: "2026-09-06",
    declared_by: "shed", home_images: { "moved-x": media(S_FIX.alone) } },
} };
const PINS_FIX = { fen: { login: "fh-gh", id: 9821, pinned: "2026-09-04" }, shed: { login: "os-gh", id: 9825 } };

// The printout, written out by hand: the account objects in order, only fen's own picture, no `home_images`
// on a house with no picture left, two-space JSON, one newline.
const PUBLIC_FIX_RAW = JSON.stringify({ schema_version: 1, note: "invented for POS-726's FIX round", households: {
  "fen-hollow": { name: "Fen Hollow", accounts: [{ login: "fh-gh", id: 9821 }, { login: "fh2-gh", id: 9823 }],
    residents: ["fen", "reed-b", "moss-c", "lark-d", "tern-e", "kit-f"], since: "2026-09-04", declared_by: "fen", home_images: { fen: IMG } },
  "odd-shed": { name: "Odd Shed", accounts: [{ login: "os-gh", id: 9825 }], residents: ["shed", "gone-wren"], since: "2026-09-06", declared_by: "shed" },
} }, null, 2) + "\n";
const PINS_FIX_RAW = JSON.stringify(PINS_FIX, null, 2) + "\n";

test("§ 6 the FIX round: the printout keeps only this house's residents' URL text and the account objects; the drain writes it and --check is green", async () => {
  const rows = rowsFromRegistry(REG_FIX, PINS_FIX);
  const before = JSON.stringify(rows);
  const priv = renderRegistry(rows);
  assert.deepEqual(leaksFix(priv.households), Object.keys(S_FIX).sort(), "CONTROL: the private render still prints every bad entry and the human");
  const pub = renderPublicRegistry(rows);
  assert.deepEqual(leaksFix(pub.households + pub.pins), [], "no bad entry in the printout (the list names each one that is)");
  assert.equal(pub.households, PUBLIC_FIX_RAW, "households.json, byte for byte");
  assert.equal(pub.pins, PINS_FIX_RAW, "github-ids.json, byte for byte");
  assert.equal(JSON.stringify(rows), before, "the rows handed in are unchanged");

  await withStore(rowsFromRegistry(REG_FIX, PINS_FIX), async (pool) => {
    const storeBefore = JSON.stringify(pool.state);
    const clone = cloneWith("{}\n", "{}\n");
    const r = await drainRegistry({ clone, env: RECORD_ON, commit: () => "c0ffee" });
    assert.equal(r.ran, true, r.refused ?? r.skipped);
    assert.equal(read(clone, REGISTRY_PATH), PUBLIC_FIX_RAW, "the printout the drain wrote from the store, byte for byte");
    assert.equal(read(clone, PINS_PATH), PINS_FIX_RAW);
    const gate = await checkRegistry({ clone, env: RECORD_ON });
    assert.equal(gate.ok, true, JSON.stringify(gate.diffs));
    assert.equal(JSON.stringify(pool.state), storeBefore, "the store is untouched by the drain");
    assert.deepEqual(leaksFix(JSON.stringify(pool.state)), Object.keys(S_FIX).sort(), "CONTROL: the store still holds every bad entry");
  });
});
