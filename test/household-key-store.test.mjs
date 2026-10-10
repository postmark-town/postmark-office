// household-key-store.test.mjs — THE STORE WRITES THE HOUSE'S KEY (POS-457).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/household-key-store.test.mjs
//
// THE INSTANCE. On the 10-08 dump, every act a signed-in resident wrote after
// the law date (2026-09-27) was filed under `solo:<their GitHub login>`: 2,938
// acts and 260 claims, against 859 and 16 under `hh:<slug>`. Wildcat's acts
// read `solo:commander-and-chief`; wildcat is `hh:house-of-many-doors`. The
// pen asked the deriver about `row.household`, which the door fills with the
// KEY'S LABEL (the login), and the deriver will not match a login for an
// account pinned by id, by design. Darko ruled A on POS-457: the store never
// respells (Ruling 4); the writers derive the slug key, and the reads that were
// keyed on the label derive from the key's handles.
//
// THE RIG. A real Postgres with the whole schema (024's spelling-set policies
// included), the registry seeded, and the office's own functions driven
// in-process under `office_api`, as sponsored-stake-clears.test.mjs does. The
// draft privacy questions are asked of the ROW POLICY, not of a stub.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "household_key_store_test" });
after(() => store.stop()); // a store never stopped left its server running on every run (POS-479)
const skip = store.skip ?? false;
const OPEN = 240;
const LOGIN = "CrowAndClock";
const ROOKERY_ID = 265401358;
const ENV = { WORLD2_CANDLE: "1", WORLD2_PG: "1" };

/** The rookery (wren, robin; its account CrowAndClock), the elsewhere (finch), and no house for vireo. */
async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, stamp_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    const opens = new Date(Date.UTC(2026, 9, 8, 18)).toISOString();
    await c.query(
      `INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')`,
      [OPEN, opens]);
    await c.query(
      `INSERT INTO households (slug, ord, name, accounts, residents, since, declared_by)
       VALUES ('rookery', 0, 'The Rookery', $1::jsonb, ARRAY['wren','robin'], '2026-08-01', 'wren'),
              ('elsewhere', 1, 'Elsewhere', '[{"id": 777, "login": "finchling"}]'::jsonb, ARRAY['finch'], '2026-08-01', 'finch'),
              ('robin', 2, 'Robin''s Nest', '[{"id": 778, "login": "jaybird"}]'::jsonb, ARRAY['jay'], '2026-08-01', 'jay')`,
      [JSON.stringify([{ id: ROOKERY_ID, login: LOGIN }])]);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('wren', $1, $2, '2026-08-01'), ('robin', $1, $2, '2026-08-01'), ('finch', 'finchling', 777, '2026-08-01'), ('jay', 'jaybird', 778, '2026-08-01')`,
      [LOGIN, ROOKERY_ID]);
  } finally { await c.end(); }
}

/** A private draft, as the pen files one. */
async function draft(slug, household, claimant = "wren") {
  const c = await store.connect("world2_owner");
  try {
    const { rows: [r] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug)
       VALUES ($1, 'sited', $2, $3, 'draft', 'a private thought', $4, 0, '{"date":"2026-10-08"}', $5)
       RETURNING id::text`,
      [OPEN, claimant, household, JSON.stringify({ slug, at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } }), slug]);
    return r.id;
  } finally { await c.end(); }
}

async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

/** The office, in-process, holding the `office_api` pen. */
async function asOffice(fn) {
  const claims = await import("../src/world2-claims.mjs");
  const { __clearHouseCache } = await import("../src/household-deriver.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 1 });
  __clearHouseCache();
  claims.__setPoolForTest(pool);
  try { return await fn(claims, pool, { ...ENV, WORLD2_PG_URL: store.url("office_api") }); }
  finally { claims.__setPoolForTest(null); await pool.end(); }
}

const OWNER_KEY = { household: LOGIN, handles: new Set(["wren"]), ghId: ROOKERY_ID };
// A recycled login: GitHub released "CrowAndClock" and a stranger (id 999) took
// it. Their key wears the label; nothing in the rookery is theirs.
const RECYCLED_KEY = { household: LOGIN, handles: new Set(["vireo"]), ghId: 999 };

// ── THE WRITERS ─────────────────────────────────────────────────────────────

test("THE PEN: a signed-in resident's act and claim are filed under the house's slug key, not solo:<login>", { skip }, async () => {
  await seed();
  await asOffice(async (claims, pool, env) => {
    // the row the door builds: the acting handle, and the key's label on `household`
    assert.equal(await claims.claimHouseholdFor({ actor: "wren", household: LOGIN }, env), "hh:rookery",
      "the acting handle names the house; the login label was never a spelling the deriver may read");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "human-of-rookery", household: LOGIN }), "hh:rookery",
      "a human's hand (human-of-<slug>) is filed under the house it was named after");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "vireo", household: "vireo-login" }), "solo:vireo",
      "a houseless actor is its own solo:<handle>; the login label is never asked");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "vireo", household: LOGIN }), "solo:vireo",
      "a recycled login is not filed into the house that once held it: the actor's own solo:<handle> instead");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "vireo", household: "solo:vireo" }), "solo:vireo",
      "a row already carrying a solo: key is not wrapped twice (the census found solo:solo:martes on a ride)");
  });
});

// ── THE READS, AND THE ROW POLICY ───────────────────────────────────────────

test("A NEW DRAFT under hh:<slug> is visible to its resident, and a stake on it is put forward (promoted: true)", { skip }, async () => {
  await seed();
  const hh = await asOffice((claims, _p, env) => claims.claimHouseholdFor({ actor: "wren", household: LOGIN }, env));
  await draft("wren/the-new-draft", hh);
  await asOffice(async (claims, _p, env) => {
    const mine = await claims.readDraftClaims(OWNER_KEY, env);
    assert.ok(JSON.stringify(mine).includes("wren/the-new-draft"), "the owner's key reads the draft the pen filed under the slug");
    const out = await claims.promoteDraftOnStake({ actor: "wren", householdName: LOGIN, key: OWNER_KEY, slug: "wren/the-new-draft", stamps: 1 }, env);
    assert.equal(out.promoted, true, "the stake door reaches it through 024's policy");
  });
  const [row] = await read("SELECT status, stake FROM claims WHERE slug = 'wren/the-new-draft'");
  assert.deepEqual(row, { status: "pending", stake: 1 });
});

test("AN OLD DRAFT under solo:<login> is still visible, editable and deletable by its owner", { skip }, async () => {
  await seed();
  await draft("wren/the-old-draft", `solo:${LOGIN}`);
  await draft("wren/the-old-doodle", `solo:${LOGIN}`);
  await asOffice(async (claims, pool, env) => {
    const mine = JSON.stringify(await claims.readDraftClaims(OWNER_KEY, env));
    assert.ok(mine.includes("wren/the-old-draft") && mine.includes("wren/the-old-doodle"), "both old drafts are read");
    const house = (await claims.keyHouseholdOf(pool, OWNER_KEY)).household;
    assert.equal(house, "hh:rookery");
    const { updated, deleted } = await claims.withHousehold(pool, house, async (c) => ({
      updated: (await c.query("UPDATE claims SET body = 'edited' WHERE slug = 'wren/the-old-draft' AND status = 'draft'")).rowCount,
      deleted: (await c.query("DELETE FROM claims WHERE slug = 'wren/the-old-doodle' AND status = 'draft'")).rowCount,
    }));
    assert.deepEqual({ updated, deleted }, { updated: 1, deleted: 1 }, "024's set admits the house's own solo:<login>, so the policy lets the owner edit and delete");
  });
  assert.deepEqual(await read("SELECT slug, body FROM claims ORDER BY slug"), [{ slug: "wren/the-old-draft", body: "edited" }]);
});

test("A RECYCLED LOGIN reads none of the old house's drafts and cannot put one forward", { skip }, async () => {
  await seed();
  await draft("wren/the-old-draft", `solo:${LOGIN}`);
  await draft("wren/the-new-draft", "hh:rookery");
  await asOffice(async (claims, pool, env) => {
    const theirs = await claims.readDraftClaims(RECYCLED_KEY, env);
    const seen = JSON.stringify(theirs);
    assert.ok(!seen.includes("wren/the-old-draft") && !seen.includes("wren/the-new-draft"),
      `the stranger wearing the old login reads none of the rookery's drafts (read: ${seen.slice(0, 200)})`);
    assert.equal((await claims.keyHouseholdOf(pool, RECYCLED_KEY)).household, "solo:vireo",
      "their key answers its own handle, never the label the rookery's account once wore");
    for (const slug of ["wren/the-old-draft", "wren/the-new-draft"]) {
      const out = await claims.promoteDraftOnStake({ actor: "wren", householdName: LOGIN, key: RECYCLED_KEY, slug, stamps: 1 }, env);
      assert.equal(out.promoted, false, `a stake from the recycled login does not put ${slug} forward`);
    }
  });
  assert.deepEqual((await read("SELECT DISTINCT status FROM claims")).map((r) => r.status), ["draft"]);
});

// ── THE PROJECTIONS ─────────────────────────────────────────────────────────
//
// escrow_projection and stamp_projection are rebuilt from the TOWN at every
// clearing, through the town's own dated resolver, which spells most of the
// town `gh:<id>`. Migrating their rows would do nothing; the pen re-keys what it
// writes. The weights are the town's arithmetic and are held to it.

const TOWN_SHA = "e".repeat(40);
const ESCROW = [
  // the rookery's mark, staked by its own house (two spellings of it) and by elsewhere
  { mark: "wren/the-bell", holder: "robin", household: `gh:${ROOKERY_ID}`, own_household: `gh:${ROOKERY_ID}`, n: 2, weight_k: 1 },
  { mark: "wren/the-bell", holder: "finch", household: "gh:777", own_household: `gh:${ROOKERY_ID}`, n: 1, weight_k: 1 },
  { mark: "wren/the-bell", holder: "wren", household: `solo:${LOGIN}`, own_household: `gh:${ROOKERY_ID}`, n: 1, weight_k: 1 },
  // a spelling no house claims stays as the town wrote it
  { mark: "the-town/the-lamp", holder: "vireo", household: "solo:vireo", own_household: "solo:the-town", n: 1, weight_k: 1 },
];

test("keyEscrowRows re-keys to the house and keeps the town's weights; a re-key that would move a weight keeps the town's spellings", async () => {
  const { keyEscrowRows } = await import("../world2/tools/escrow-ingest.mjs");
  const live = new Map([[`gh:${ROOKERY_ID}`, "hh:rookery"], [`solo:${LOGIN}`, "hh:rookery"], ["gh:777", "hh:elsewhere"]]);
  const houseOf = (k) => live.get(k) ?? k;
  // `solo:CrowAndClock` and `gh:<id>` are ONE house, so the town's walk drew k
  // for wren's position as an external household, and the re-key would not:
  // the arithmetic moves, so the whole sha keeps the town's spellings.
  const merged = keyEscrowRows(ESCROW, houseOf);
  assert.equal(merged.rows, ESCROW, "the town's rows, unchanged");
  assert.deepEqual(merged.merged, ["wren/the-bell|wren"], "and the position whose weight would move is named");

  const consistent = ESCROW.filter((r) => r.holder !== "wren");
  const out = keyEscrowRows(consistent, houseOf);
  assert.equal(out.merged, null);
  assert.deepEqual(out.rows.map((r) => [r.holder, r.household, r.own_household]), [
    ["robin", "hh:rookery", "hh:rookery"],
    ["finch", "hh:elsewhere", "hh:rookery"],
    ["vireo", "solo:vireo", "solo:the-town"],
  ], "each spelling a house has worn becomes its slug key; one no house claims stays");
  assert.equal(out.rekeyed, 2);
});

test("THE ONE PEN: writeStamps files stamp_projection and escrow_projection under the house's slug key", { skip }, async () => {
  await seed();
  const { writeStamps } = await import("../world2/tools/stamp-ingest.mjs");
  const { __clearHouseCache } = await import("../src/household-deriver.mjs");
  __clearHouseCache();
  const c = await store.connect("law_ingester");
  try {
    await writeStamps(c, {
      townSha: TOWN_SHA,
      rows: [
        { handle: "robin", household: `gh:${ROOKERY_ID}`, balance: 3 },
        { handle: "finch", household: "gh:777", balance: 1 },
        { handle: "vireo", household: "login:vireo-login", balance: 0 },
      ],
      rollRows: [],
      escrowRows: ESCROW.filter((r) => r.holder !== "wren"),
    });
  } finally { await c.end(); }
  assert.deepEqual(await read("SELECT handle, household FROM stamp_projection ORDER BY handle"), [
    { handle: "finch", household: "hh:elsewhere" },
    { handle: "robin", household: "hh:rookery" },
    { handle: "vireo", household: "login:vireo-login" },
  ], "the town's gh:<id> becomes the slug key; a spelling no house claims is kept, never guessed");
  assert.deepEqual(await read("SELECT holder, household, own_household FROM escrow_projection ORDER BY holder"), [
    { holder: "finch", household: "hh:elsewhere", own_household: "hh:rookery" },
    { holder: "robin", household: "hh:rookery", own_household: "hh:rookery" },
    { holder: "vireo", household: "solo:vireo", own_household: "solo:the-town" },
  ]);
});

// ── THE REVIEW OF #438: THE BARE LABEL, THE HUMAN'S HAND, EVERY HOUSE ────────
//
// A visitor key is `{ household: <login>, handles: ∅, ghId }` (oauth.mjs). The
// deriver reads a bare string as a handle, a pin, a slug or a former slug, so
// handing it the login would place a stranger whose GitHub login happens to be
// a house's slug, or a resident's handle, inside that house.

const SLUG_LOGIN_KEY = { household: "rookery", handles: new Set(), ghId: 901 };   // login = a house's slug
const HANDLE_LOGIN_KEY = { household: "wren", handles: new Set(), ghId: 902 };    // login = a resident's handle

test("A LOGIN THAT EQUALS A SLUG OR A HANDLE places nobody: no read, no promotion, no write into that house", { skip }, async () => {
  await seed();
  await draft("wren/the-old-draft", `solo:${LOGIN}`);
  await draft("wren/the-new-draft", "hh:rookery");
  await asOffice(async (claims, pool, env) => {
    for (const [name, key, own] of [["slug", SLUG_LOGIN_KEY, "gh:901"], ["handle", HANDLE_LOGIN_KEY, "gh:902"]]) {
      assert.equal((await claims.keyHouseholdOf(pool, key)).household, own, `a login equal to a ${name} answers its own account, never the house`);
      const seen = JSON.stringify(await claims.readDraftClaims(key, env));
      assert.ok(!seen.includes("wren/"), `a login equal to a ${name} reads none of the rookery's drafts (read: ${seen.slice(0, 160)})`);
      for (const slug of ["wren/the-old-draft", "wren/the-new-draft"]) {
        const out = await claims.promoteDraftOnStake({ actor: "wren", householdName: key.household, key, slug, stamps: 1 }, env);
        assert.equal(out.promoted, false, `a login equal to a ${name} does not put ${slug} forward`);
      }
    }
    assert.equal(await claims.actHouseholdFor(pool, { actor: "vireo", household: "rookery" }), "solo:vireo",
      "a houseless actor whose label is a slug is not filed into that house");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "vireo", household: "wren" }), "solo:vireo",
      "nor one whose label is a resident's handle");
  });
});

test("A HUMAN'S HAND names its house by the slug first: human-of-robin is Robin's Nest, not the house robin lives in", { skip }, async () => {
  await seed();
  await asOffice(async (claims, pool) => {
    assert.equal(await claims.actHouseholdFor(pool, { actor: "human-of-robin", household: "jaybird" }), "hh:robin",
      "robin is a slug and also a rookery resident; the hand was minted from the slug");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "human-of-wren", household: LOGIN }), "hh:rookery",
      "a hand minted from a handle (a house with no slug then) still reaches that handle's house");
    assert.equal(await claims.actHouseholdFor(pool, { actor: "robin", household: LOGIN }), "hh:rookery",
      "and the bare handle robin is the resident, never the slug");
  });
});

test("A KEY IN NO HOUSE, with no handles and no account, answers null and reads only what is public", { skip }, async () => {
  await seed();
  await draft("wren/the-old-draft", `solo:${LOGIN}`);
  await asOffice(async (claims, pool, env) => {
    const bare = { household: "rookery", handles: new Set() };
    assert.equal((await claims.keyHouseholdOf(pool, bare)).household, null);
    assert.deepEqual((await claims.readDraftClaims(bare, env)).drafts, []);
  });
});

test("EVERY HOUSE A KEY STANDS IN: a second-house handle's draft is read and put forward", { skip }, async () => {
  await seed();
  await draft("finch/a-draft-elsewhere", "hh:elsewhere", "finch");
  await draft("wren/a-draft-at-home", "hh:rookery");
  const both = { household: LOGIN, handles: new Set(["wren", "finch"]), ghId: ROOKERY_ID };
  await asOffice(async (claims, _p, env) => {
    const seen = JSON.stringify(await claims.readDraftClaims(both, env));
    assert.ok(seen.includes("wren/a-draft-at-home") && seen.includes("finch/a-draft-elsewhere"), "both houses' drafts are read");
    const out = await claims.promoteDraftOnStake({ actor: "finch", householdName: LOGIN, key: both, slug: "finch/a-draft-elsewhere", stamps: 1 }, env);
    assert.equal(out.promoted, true, "the second house's draft is put forward");
  });
});

test("THE CENSUS after a ship: a houseless resident's solo:<handle> is lawful, a solo:<login> by a housed resident is a straggler", { skip }, async () => {
  await seed();
  const { census } = await import("../world2/tools/household-key-census.mjs");
  const { __clearHouseCache } = await import("../src/household-deriver.mjs");
  const since = new Date(Date.now() - 60e3).toISOString();
  await draft("vireo/a-houseless-draft", "solo:vireo", "vireo");
  __clearHouseCache();
  let c = await store.connect("world2_owner");
  try {
    const r = await census(c, { after: since });
    assert.equal(r.after_ok, true, `a resident in no house filed under its own handle is not a straggler: ${JSON.stringify(r.after.claims)}`);
    assert.ok(Object.keys(r.after.claims).some((w) => w.startsWith("houseless:")));
  } finally { await c.end(); }
  await draft("wren/filed-the-old-way", `solo:${LOGIN}`);
  __clearHouseCache();
  c = await store.connect("world2_owner");
  try {
    const r = await census(c, { after: since });
    assert.equal(r.after_ok, false, "a housed resident's row under solo:<login> is a straggler");
  } finally { await c.end(); }
});
