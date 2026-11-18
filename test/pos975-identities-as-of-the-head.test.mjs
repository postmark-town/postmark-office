// pos975-identities-as-of-the-head.test.mjs — the town check holds like with like (POS-975, part 2).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos975-identities-as-of-the-head.test.mjs
//
// THE FALSE FINDING. The restore rehearsal of 11-18 read RED on "opie": a resident
// admitted to the registry after the last settlement. `identities` is a VIEW over the
// LIVE registry (055: households + household_pins, edited in place by office_api, no
// history), while `town_roll` is read at the town head, which moves only at a settlement.
// The invariant "identities ⊆ town_roll" compared two moments.
//
// THE REPAIR (ruled by Jetto on option A): the identities are taken as of the head, which
// is what the town checkout at the recorded sha names in its own registry files
// (tools/households.json residents + tools/github-ids.json keys). A store identity those
// files do not name is a NOTE ("postdate the head or never drained"), not a finding; a
// never-drained one is registry-drain --check's to catch. The identities are read from a
// REAL store (the tree's Postgres), through the view, not a stub.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { checkIdentities } from "../world2/tools/falsifier-projection-equality.mjs";

const store = await startStore({ db: "pos975_identities_as_of_the_head" });
after(() => store.stop());
const skip = store.skip ?? false;

// The registry in the store, as the ceremony wrote it: the live state NOW.
const STORE_HOUSES = [
  ["h-astra", 0, ["astra-first"]],
  ["h-dylan", 1, ["dylan", "dylan-android-husband"]],
  ["h-eloise", 2, ["eloise-stellanova", "wesley-seeker"]],
];
const STORE_PINS = {
  "astra-first": { login: "astra", id: 1 },
  dylan: { login: "XAesirX", id: 312413958 },
  "dylan-android-husband": { login: "XAesirX", id: 312413958, retired: "2026-08-04", renamed_to: "dylan" },
  "eloise-stellanova": { login: "wesleymons22-coder", id: 324643059 },
  "wesley-seeker": { login: "wesleymons22-coder", id: 324643059, retired: "2026-09-09", renamed_to: "eloise-stellanova" },
};
const ROLL = new Set(["astra-first", "dylan", "eloise-stellanova"]);

async function seedStore(extra = []) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE households, household_pins CASCADE");
    for (const [slug, ord, residents] of [...STORE_HOUSES, ...extra.map((h, i) => [h.slug, 10 + i, h.residents])]) {
      await c.query(
        `INSERT INTO households (slug, ord, accounts, residents, since, declared_by) VALUES ($1, $2, '[]'::jsonb, $3::text[], '2026-11-01', $4)`,
        [slug, ord, residents, residents[0]]);
    }
    for (const [handle, p] of Object.entries(STORE_PINS)) {
      await c.query(
        `INSERT INTO household_pins (handle, login, gh_id, pinned, retired, renamed_to) VALUES ($1, $2, $3, '2026-08-01', $4, $5)`,
        [handle, p.login, p.id, p.retired ?? null, p.renamed_to ?? null]);
    }
  } finally { await c.end(); }
}

/** A town checkout whose registry files are the head's: households named by slug, pins by handle. */
function townAtTheHead(houses, pins) {
  const town = tempDir("pos975-head-");
  mkdirSync(join(town, "tools"), { recursive: true });
  writeFileSync(join(town, "tools", "households.json"), JSON.stringify({ schema_version: 1, note: "x",
    households: Object.fromEntries(houses.map(([slug, residents]) => [slug, { residents, since: "2026-08-01" }])) }, null, 2));
  writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify(pins, null, 2));
  return town;
}
const HEAD_HOUSES = STORE_HOUSES.map(([slug, , residents]) => [slug, residents]);

async function verdict(town, roll = ROLL) {
  const c = await store.connect("law_ingester");
  try { return await checkIdentities(c, roll, town); } finally { await c.end(); }
}

test("POS-975 · THE SKEW: a resident admitted after the head (in the store, not in the head's files) is a note, not a finding", { skip }, async () => {
  await seedStore([{ slug: "h-opie", residents: ["opie"] }]);
  const out = await verdict(townAtTheHead(HEAD_HOUSES, STORE_PINS));
  assert.deepEqual(out.orphans, [], "opie is not in the roll, but the head's registry never held opie: no finding");
  assert.deepEqual(out.postdate, ["opie"], "and the store's opie is named, so nobody has to trust a quiet pass");
  assert.equal(out.unreadable, null);
});

test("POS-975 · a REAL ORPHAN: named in the head's files, missing from the roll, is still a finding (beside a post-head admission)", { skip }, async () => {
  await seedStore([{ slug: "h-stranger", residents: ["stranger"] }, { slug: "h-opie", residents: ["opie"] }]);
  const out = await verdict(townAtTheHead([...HEAD_HOUSES, ["h-stranger", ["stranger"]]], STORE_PINS));
  assert.deepEqual(out.orphans, ["stranger"]);
  assert.deepEqual(out.postdate, ["opie"], "the late admission is not folded into the orphans");
});

test("POS-975 · a real orphan named only by a PIN of the head (no house lists it) is still a finding", { skip }, async () => {
  await seedStore([{ slug: "h-pinned", residents: ["pinned-one"] }]);
  const pins = { ...STORE_PINS, "pinned-one": { login: "p", id: 9 } };
  const out = await verdict(townAtTheHead(HEAD_HOUSES, pins));
  assert.deepEqual(out.orphans, ["pinned-one"]);
});

test("POS-975 · the renames still hold: the two retired keys are the same residents, noted, with the head's pins", { skip }, async () => {
  await seedStore();
  const out = await verdict(townAtTheHead(HEAD_HOUSES, STORE_PINS));
  assert.deepEqual(out.orphans, []);
  assert.deepEqual(out.renamed.map((r) => [r.handle, r.renamed_to]), [
    ["dylan-android-husband", "dylan"], ["wesley-seeker", "eloise-stellanova"]]);
  assert.deepEqual(out.postdate, []);
});

test("POS-975 · a rename whose head pins do not say so is still RED (the one-hop law is unchanged)", { skip }, async () => {
  await seedStore();
  const pins = { ...STORE_PINS, "wesley-seeker": { login: "wesleymons22-coder", id: 324643059 } };
  const out = await verdict(townAtTheHead(HEAD_HOUSES, pins));
  assert.deepEqual(out.orphans, ["wesley-seeker"]);
});

test("POS-975 · a checkout that cannot say what the head held is CANNOT-RUN, never a store of quiet post-head notes", { skip }, async () => {
  await seedStore([{ slug: "h-stranger", residents: ["stranger"] }]);
  const empty = tempDir("pos975-empty-");
  const out = await verdict(empty);
  assert.match(out.unreadable, /no readable tools\/households\.json/);
  assert.deepEqual(out.orphans, [], "nothing is judged on a checkout that cannot be read");
  const half = tempDir("pos975-half-");
  mkdirSync(join(half, "tools"), { recursive: true });
  writeFileSync(join(half, "tools", "households.json"), JSON.stringify({ households: {} }));
  assert.match((await verdict(half)).unreadable, /no readable tools\/github-ids\.json/);
});
