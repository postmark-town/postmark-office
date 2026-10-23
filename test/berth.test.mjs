// berth.test.mjs — the harbor's self-mint credential (the arrival ruling,
// 2026-08-15). Unit layer only: the mint, the lookup, the sunset, the slug
// grammar. The door itself (POST /berth) and the say-through-the-apex arc are
// proven where their fixtures live — server.test.mjs and world-apex.test.mjs.
//
//   node --test test/berth.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openOauthDb, mintBerth, berthLookup, berthTaken, acknowledgeVisitorRules, BERTH_SLUG, FROM_TOWN } from "../src/oauth.mjs";
import { isReservedHandle } from "../src/residency.mjs";
import { __setPoolForTest as setActsPool } from "../src/world2-acts.mjs";
import { holdStoreProbe } from "../src/index-probe.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-berth-"));
const odb = openOauthDb(join(dir, "oauth.db"));
// ONE hook, close-then-remove: after-hooks run in registration order, and on
// Windows an open handle turns the rm into the file-level failure.
after(() => {
  odb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the slug grammar: lowercase-hyphenated, 2–31, nothing else", async () => {
  for (const good of ["wanderer", "field-tester-2", "a1", "x".repeat(31)])
    assert.ok(BERTH_SLUG.test(good), good);
  for (const bad of ["A", "x", "-lead", "trail-".repeat(8), "spa ce", "dot.name", "x".repeat(32), ""])
    assert.ok(!BERTH_SLUG.test(bad), bad);
});

test("the town's own names are refused by the one set the join desk uses", async () => {
  for (const own of ["ferry", "office", "postmaster", "the-town", "template", "index", " Ferry "])
    assert.ok(isReservedHandle(own), own);
  for (const plain of ["wanderer", "ferryman", "office-cat", "gangplank-walker"])
    assert.ok(!isReservedHandle(plain), plain);
});

test("mint → lookup round-trip: a live berth resolves to its standing, nothing more", async () => {
  const { key, expires_at } = (await mintBerth(odb, "wanderer"));
  assert.ok(key.startsWith("pmb_"), "the berth prefix names the kind");
  assert.ok(new Date(expires_at) > new Date(), "the sunset is in the future");
  const k = (await berthLookup(odb, null, null, key));
  assert.equal(k.berth, true);
  assert.equal(k.slug, "wanderer");
  assert.equal(k.household, null, "a berth holds no household — that is the whole point");
  assert.equal(k.handles.size, 0, "no resident handles ride a berth");
  assert.equal(k.cosigned, false);
  assert.ok((await berthTaken(odb, "wanderer")), "a live berth holds its name");
});

test("a wrong-prefix token is nobody, cheaply", async () => {
  assert.equal((await berthLookup(odb, null, null, "pmk_not-a-berth")), null);
  assert.equal((await berthLookup(odb, null, null, "nonsense")), null);
});

test("the sunset: an expired berth stops resolving AND frees its name", async () => {
  const { key } = (await mintBerth(odb, "ephemeral"));
  odb.prepare("UPDATE berths SET expires = 1 WHERE slug = 'ephemeral'").run();
  assert.equal((await berthLookup(odb, null, null, key)), null, "an expired key must not resolve");
  assert.ok(!(await berthTaken(odb, "ephemeral")), "an expired berth frees its slug for re-boarding");
});

test("from_town: a traveler's claim is recorded at the mint; absence stays null", async () => {
  await mintBerth(odb, "voyager", "1f3d9");
  assert.equal(odb.prepare("SELECT from_town FROM berths WHERE slug = 'voyager'").get().from_town, "1f3d9");
  await mintBerth(odb, "local");
  assert.equal(odb.prepare("SELECT from_town FROM berths WHERE slug = 'local'").get().from_town, null);
});

test("the visitors' rules (POS-300): the acknowledgement is kept on the row, read back by the key, and written once", async () => {
  const { key } = await mintBerth(odb, "rule-reader");
  assert.equal((await berthLookup(odb, null, null, key)).rulesRead, false, "a fresh berth has not read them");
  await acknowledgeVisitorRules(odb, "rule-reader");
  assert.equal((await berthLookup(odb, null, null, key)).rulesRead, true);
  // The door's gate stops a second acknowledgement before it reaches the row;
  // the row's own clause is what holds two that race. Planted: a known time,
  // then an acknowledgement, and the time must not move.
  odb.prepare("UPDATE berths SET rules_read_at = 1000 WHERE slug = 'rule-reader'").run();
  await acknowledgeVisitorRules(odb, "rule-reader");
  assert.equal(odb.prepare("SELECT rules_read_at FROM berths WHERE slug = 'rule-reader'").get().rules_read_at, 1000, "written once");
});

test("the from_town grammar admits codepoint towns and plain names, refuses noise", async () => {
  for (const good of ["1f3d9", "1f916", "ai-village", "the.commons"])
    assert.ok(FROM_TOWN.test(good), good);
  for (const bad of ["", "-lead", "UPPER", "spa ce", "x".repeat(65)])
    assert.ok(!FROM_TOWN.test(bad), bad);
});

// #3965. The server's resolver hands every lookup a null `db` since office.db
// went (POS-656), and the upgrade branch was gated on `db`, so a co-signed
// berth never upgraded. These drive the lookup exactly as the resolver does:
// null `db`, the store's pins and ashore rows (a stub pool, the world-apex
// seam), the store's held probe (a stub naming who stands in the residents
// index). The pre-fix lookup answers { berth: true, household: null,
// cosigned: true } for all three co-signed cases.
const cosignedBerth = async (slug, ghId, login) => {
  const { key } = await mintBerth(odb, slug);
  odb.prepare("UPDATE berths SET cosigned_gh_id = ?, cosigned_gh_login = ?, cosigned_at = 1 WHERE slug = ?").run(ghId, login, slug);
  return key;
};
const withStore = async ({ pins, residents = [], ashore = [] }, fn) => {
  const saved = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub.invalid/never-dialled";
  setActsPool({ query: async (sql) => ({ rows: /FROM ashore/.test(sql) ? ashore.map((handle) => ({ handle })) : pins }) });
  holdStoreProbe({
    hasResident: (h) => residents.includes(h), hasLetter: () => false,
    loginStamp: () => "stub", loginRows: () => [], mailStateJson: () => null,
  });
  try { return await fn(); } finally {
    setActsPool(null);
    holdStoreProbe(null);
    for (const [name, v] of Object.entries(saved)) { if (v == null) delete process.env[name]; else process.env[name] = v; }
  }
};

test("a co-signed berth upgrades in place under the resolver's null db (#3965)", async () => {
  const key = await cosignedBerth("upgrade-heir", 4242, "heir-human");
  await withStore({ pins: [{ handle: "upgrade-heir", login: "heir-human", gh_id: 4242 }], residents: ["upgrade-heir"] }, async () => {
    const k = await berthLookup(odb, null, null, key);
    assert.equal(k.keyKind, "berth-upgraded", "the same key answers as the household");
    assert.ok(k.handles.has("upgrade-heir"), "the household holds the berth's handle");
    assert.equal(k.household, "heir-human");
    assert.equal(k.cosigned, true);
    assert.equal(k.berth, undefined, "a settled household sheds the berth marker");
    assert.equal(k.harbor, undefined);
  });
});

test("a co-signed berth whose household is still at the harbor keeps the quay voice under a null db (#3965)", async () => {
  const key = await cosignedBerth("harbor-heir", 4343, "harbor-human");
  // Pinned to the account, but in neither the residents index nor the store's
  // ashore rows: the household stands at the harbor.
  await withStore({ pins: [{ handle: "harbor-heir", login: "harbor-human", gh_id: 4343 }] }, async () => {
    const k = await berthLookup(odb, null, null, key);
    assert.equal(k.keyKind, "berth-upgraded", "the key answers as the household");
    assert.ok(k.handles.has("harbor-heir"));
    assert.equal(k.harbor, true);
    assert.equal(k.berth, "harbor-heir", "a harbor household keeps the berth marker");
    assert.equal(k.slug, "harbor-heir");
    assert.equal(k.rulesRead, false);
    assert.equal(k.cosigned, true);
  });
});

test("a co-signed berth whose account the registry does not know stays a berth under a null db (#3965)", async () => {
  const key = await cosignedBerth("unknown-heir", 4444, "unknown-human");
  // The store's pins name another account entirely, and no login row binds this one.
  await withStore({ pins: [{ handle: "someone-else", login: "other-human", gh_id: 9999 }], residents: ["someone-else"] }, async () => {
    const k = await berthLookup(odb, null, null, key);
    assert.equal(k.berth, true, "no household match falls back to the berth shape");
    assert.equal(k.household, null);
    assert.equal(k.handles.size, 0);
    assert.equal(k.cosigned, true);
    assert.equal(k.keyKind, undefined);
  });
});

test("an unco-signed berth never asks the registry (#3965)", async () => {
  const { key } = await mintBerth(odb, "still-at-quay");
  // No pool, no probe: if the lookup asked, the refusing probe or the unpointed
  // store would throw. It must answer the quay shape without asking.
  const k = await berthLookup(odb, null, null, key);
  assert.equal(k.berth, true);
  assert.equal(k.cosigned, false);
  assert.equal(k.keyKind, undefined);
});

// ── RE-BOARDING COSTS ONE POST (POS-761) ────────────────────────────────────
//
// A visitor whose berth sunset boards again under the same name. Minting used
// to INSERT over a row that is never deleted, and the store refused it
// (UNIQUE berths.slug). The sunset row is now kept under its archive name,
// `<slug>~<created>`, and the name is free.

const reMint = async (paper, run) => {
  const first = await mintBerth(paper, "returning", "remint-town");
  await run("UPDATE berths SET card = ?, expires = 1 WHERE slug = 'returning'", JSON.stringify({ household: "The Old Visit" }));
  const second = await mintBerth(paper, "returning", "remint-town");
  return { first, second };
};

test("FALSIFIER: an expired berth's name boards again in one POST, and the old berth is kept, not lost", async () => {
  const { first, second } = await reMint(odb, (sql, ...a) => odb.prepare(sql).run(...a));
  const k = await berthLookup(odb, null, null, second.key);
  assert.equal(k?.slug, "returning", "the new key does not resolve to the re-boarded name");
  assert.equal(await berthLookup(odb, null, null, first.key), null, "the sunset key came back to life");
  const rows = odb.prepare("SELECT slug, card FROM berths WHERE slug = 'returning' OR slug LIKE 'returning~%' ORDER BY slug").all();
  assert.equal(rows.length, 2, "the sunset berth was dropped from the record");
  assert.match(rows[1].slug, /^returning~\d+$/, "the old berth keeps an archive name no slug can take");
  assert.equal(JSON.parse(rows[1].card).household, "The Old Visit", "the old berth's card went with it");
  assert.equal(rows[0].card, null, "the new berth inherited the old one's declaration");
  const { berthArrivals } = await import("../src/oauth.mjs");
  const shore = (await berthArrivals(odb, undefined, { chartered: ["remint-town"] }))["remint-town"];
  assert.deepEqual({ ever: shore.ever, live: shore.live }, { ever: 2, live: 1 }, "the harbor's count lost a boarding");
  // a live berth's name is still held: no archive of a berth that has not sunset
  await mintBerth(odb, "still-here");
  await assert.rejects(() => mintBerth(odb, "still-here"), (e) => e.code === 409 && /already held/.test(e.defect), "a live berth's name was taken from under it");
});

test("ON THE STORE: the re-mint runs on Postgres's own oauth_berths, as the office runs it", async () => {
  const { startStore } = await import("./helpers/embedded-store.mjs");
  const { paperOnPool, paperworkPoolTypes } = await import("../src/paperwork.mjs");
  const s = await startStore({ db: "berth_remint" });
  if (s.skip) return;
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2, types: paperworkPoolTypes(pg) });
  try {
    const paper = paperOnPool(pool);
    const { second } = await reMint(paper, (sql, ...a) => paper.run(sql, ...a));
    assert.equal((await berthLookup(paper, null, null, second.key))?.slug, "returning");
    const owner = await s.connect("world2_owner");
    try {
      const { rows } = await owner.query("SELECT slug FROM oauth_berths WHERE slug LIKE 'returning%' ORDER BY slug");
      assert.deepEqual(rows.map((r) => r.slug.replace(/~\d+$/, "~<created>")), ["returning", "returning~<created>"]);
    } finally { await owner.end(); }
  } finally { await pool.end(); await s.stop?.(); }
});

test("POS-761: a berth is live through its last second, so its name is held at expires == t and free one second after", async () => {
  const t0 = 1_900_000_000;
  const { key } = await mintBerth(odb, "edge-of-sunset", null, { t: t0 });
  const expires = odb.prepare("SELECT expires FROM berths WHERE slug = 'edge-of-sunset'").get().expires;
  await assert.rejects(() => mintBerth(odb, "edge-of-sunset", null, { t: expires }),
    (e) => e.code === 409 && /already held/.test(e.defect), "the name was taken from a berth in its last second");
  assert.equal(odb.prepare("SELECT count(*) AS n FROM berths WHERE slug LIKE 'edge-of-sunset%'").get().n, 1, "a refused boarding archived the live berth anyway");
  await mintBerth(odb, "edge-of-sunset", null, { t: expires + 1 });
  assert.equal(odb.prepare("SELECT count(*) AS n FROM berths WHERE slug LIKE 'edge-of-sunset%'").get().n, 2);
  assert.ok(key);
});

test("POS-761: the rules acknowledgement and the co-sign write land on THIS berth's row, never a later visitor's under its name", async () => {
  const t0 = 1_900_100_000;
  await mintBerth(odb, "pinned-name", null, { t: t0 });
  const old = odb.prepare("SELECT created, token_hash FROM berths WHERE slug = 'pinned-name'").get();
  odb.prepare("UPDATE berths SET expires = 1 WHERE slug = 'pinned-name'").run();
  await mintBerth(odb, "pinned-name", null, { t: t0 + 10 });
  // the old berth's key acknowledges, after the name was boarded again
  await acknowledgeVisitorRules(odb, "pinned-name", old.created * 1000);
  assert.equal(odb.prepare("SELECT rules_read_at FROM berths WHERE slug = 'pinned-name'").get().rules_read_at, null,
    "the old visitor's acknowledgement was written on the new visitor's berth");
  // the co-sign's own statement, read from the office, run for the OLD berth's token
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/oauth.mjs", import.meta.url), "utf8");
  const sql = /odb\.run\("(UPDATE berths SET cosigned_gh_id = \?, cosigned_gh_login = \?, cosigned_at = \? WHERE [^"]+)"/.exec(src)?.[1];
  assert.ok(sql, "the co-sign's write is not where this test reads it");
  const r = odb.prepare(sql).run(4242, "old-human", 1, "pinned-name", old.token_hash);
  assert.equal(Number(r.changes), 0, "the old berth's co-sign wrote onto the stranger's row");
  assert.equal(odb.prepare("SELECT cosigned_gh_id FROM berths WHERE slug = 'pinned-name'").get().cosigned_gh_id, null);
});
