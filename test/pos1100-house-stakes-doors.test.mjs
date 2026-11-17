// pos1100-house-stakes-doors.test.mjs — the doors a house reads its stakes at, each counting a post stake (POS-1100).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/pos1100-house-stakes-doors.test.mjs
//
// The ledger and the list's own claims are pos1100-house-stakes.test.mjs. This file drives the REAL DOORS over a
// fixture house and a scratch town's signed ledger (WIRING-AND-PINS: a function existing is not a function running):
//
//   household { read: "stakes" }          the paged list, with the aggregate beside it
//   household { read_shape: "v2" }        the glance's stamps block: the aggregate, never the list
//   the finished doorstep's stakes item   the read's own first page (it is the read at its args), on both skins
//
// and holds the one number each reports against the stamp ledger's own staked figure for the house.
//
// Synthetic handles, marks and posts throughout.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { townClone, NO_TOWN } from "./fixture-paths.mjs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinTown } from "./helpers/pinned-town.mjs";
import { importTownTool } from "../src/town-tool.mjs";
import { STAKE_KINDS } from "../src/household-stakes.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { putValues, emptyTown } from "./fixture.mjs";

const TOWN = townClone();
const skip = NO_TOWN && !TOWN ? "no town clone here" : false;
const ident = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const AS_OF = "housefixture0000000000000000000000000000";
const HOUSE = "fixture-house";
const R0 = "r000", R1 = "r001", STRANGER = "r-stranger";
const DAY = "2026-11-10";

// ── the scratch town: r000 and r001 stake on marks, posts, a pot and a ballot; the stranger's stakes are not the house's ──
let town, M, savedTown;
const entries = () => M.parseStampLedger(readFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
let HOUSE_STAKED = 0;
if (!skip) {
  town = tempDir("pos1100-doors-town-");
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, town);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(town, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  execFileSync("git", ["init", "-q", "-b", "main", town]);
  process.env.TOWN_PINS_DIR = pinTown(town);
  M = await importTownTool(town, "stamp-mint.mjs");
  const gift = (handle, n) => M.giftLine({ date: "2026-09-01", handle, n, slug: `seed-${handle}`, by: "the-town" });
  M.appendSigned(town, [
    M.rulesLine("2026-06-12"), gift(R0, 500), gift(R1, 500), gift(STRANGER, 500),
    M.worldStakeLine({ date: DAY, handle: R0, mark: "r000/own-mark", n: 4, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: R1, mark: "r-stranger/their-mark", n: 3, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: STRANGER, mark: "r000/own-mark", n: 9, via: "api" }),
    M.postStakeLine({ date: DAY, handle: R0, post: "r000/an-idea", n: 5, side: "for", via: "api" }),
    M.postStakeLine({ date: DAY, handle: R1, post: "r-stranger/their-idea", n: 6, side: "for", via: "api" }),
    M.postStakeLine({ date: DAY, handle: STRANGER, post: "r000/an-idea", n: 2, side: "for", via: "api" }),
    M.potStakeLine({ date: DAY, handle: R0, pot: "fixture-pot", n: 7, via: "api" }),
    M.stakeLine({ date: DAY, handle: R1, topic: "fixture-topic", candidate: "fixture-c", n: 8, via: "api" }),
  ], pem);
  git(town, "add", "-A"); git(town, ...ident, "commit", "-q", "--allow-empty", "-m", "fixture ledger");
  const staked = M.foldStaked(entries());
  HOUSE_STAKED = (staked.get(R0) ?? 0) + (staked.get(R1) ?? 0);
  savedTown = process.env.TOWN_CLONE;
  process.env.TOWN_CLONE = town;   // the stakes read folds THIS ledger
}
after(() => { if (savedTown === undefined) delete process.env.TOWN_CLONE; else process.env.TOWN_CLONE = savedTown; });

// ── the fixture house, as house-read.test.mjs builds it, with the store's copy of the stamps tense ──
function houseDb() {
  const db = emptyTown();
  const put = (...v) => putValues(db, "meta", v);
  put("as_of", AS_OF); put("town_path", "fixture"); put("hydrated_counts", JSON.stringify({}));
  const insR = (...v) => putValues(db, "residents", v);
  for (const [i, h] of [R0, R1, "r002", STRANGER].entries())
    insR(h, JSON.stringify({ handle: h, is_office: false, last_active: `2026-09-2${i}T10:00:00.000Z`, address: { data: { since: "2026-01-01", joined: `2026-06-1${i}` } },
      window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: `pane of ${h}` }] } }));
  putValues(db, "ledger", ["delivery", "2026-07-04", "l0", R1, R0, "{}"], ["kind", "date", "id", "from_h", "to_h", "json"]);
  // the store's copy of the ledger's tenses: (handle, liquid, minted, staked); r000 and r001 stake HOUSE_STAKED between them
  const staked = M ? M.foldStaked(entries()) : new Map();
  putValues(db, "stamps", [R0, 100, 500, staked.get(R0) ?? 0]);
  putValues(db, "stamps", [R1, 100, 500, staked.get(R1) ?? 0]);
  return db;
}
const IX = skip ? null : await indexStore(houseDb(), { db: "pos1100_doors" });
const IX_RESTORE = skip ? null : await IX.useInProcess();
after(async () => { if (IX_RESTORE) { await IX_RESTORE(); await IX.stop(); } });
const scratch = mkdtempSync(join(tmpdir(), "postmark-pos1100-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: [R0, R1, "r002"] },
  other: { name: "Other", human: "OTH", accounts: [{ login: "other", id: 2 }], residents: [STRANGER] },
} }));
__setPoolForTest(poolFromClone(scratch));
const keepRecord = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(() => {
  __setPoolForTest(null);
  if (keepRecord.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keepRecord.on;
  if (keepRecord.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keepRecord.url;
});

const key = { household: HOUSE, handles: new Set([R0, R1]) };
const ctx = { clone: scratch, asOf: AS_OF, odb: null };

test("the fixture's own arithmetic: the house's staked is 4 + 5 + 7 for r000 and 3 + 6 + 8 for r001, and not the stranger's 9 + 2", { skip }, () => {
  assert.equal(HOUSE_STAKED, 4 + 5 + 7 + 3 + 6 + 8);
});

test("household { read: \"stakes\" }: the page lists marks, posts, a pot and a ballot, and its total is the ledger's staked for the house", { skip }, async () => {
  const r = await householdApex({ read: "stakes" }, key, ctx);
  assert.ok(r.allocation, JSON.stringify(r).slice(0, 400));
  assert.equal(r.allocation.unavailable, undefined, r.allocation.unavailable);
  assert.equal(r.allocation.total, HOUSE_STAKED, "LAW (Wright on Darko 22:30, POS-1100): the totals your read reports must equal the house's escrow in the stamp ledger");
  assert.equal(r.allocation.ledger_staked, HOUSE_STAKED);
  assert.equal(r.allocation.rows.reduce((n, x) => n + x.stamps, 0), HOUSE_STAKED, "the rows on this page add up to it (the house fits one page)");
  assert.deepEqual(r.allocation.rows.map((x) => x.id).sort(), ["fixture-pot", "fixture-topic/fixture-c", "r-stranger/their-idea", "r-stranger/their-mark", "r000/an-idea", "r000/own-mark"]);
  assert.equal(r.allocation.rows.find((x) => x.id === "r000/an-idea").stamps, 5, "the stranger's 2 on the same post are not the house's");
  assert.deepEqual([r.allocation.shown, r.allocation.limit, r.allocation.complete], [6, 20, true]);
  // the marks part keeps its own place: the house's published marks and what stands behind them, as it was
  assert.ok(Array.isArray(r.rows) && "count" in r && "next_settlement" in r, "the backing on your own marks is its own part, untouched");
  // paged by the ruled pattern
  const p1 = await householdApex({ read: "stakes", args: { limit: 4 } }, key, ctx);
  assert.deepEqual([p1.allocation.shown, p1.allocation.next_offset], [4, 4]);
  assert.match(p1.allocation.more_note, /2 further stakes — call again with offset: 4/);
  const p2 = await householdApex({ read: "stakes", args: { limit: 4, offset: p1.allocation.next_offset } }, key, ctx);
  assert.deepEqual([p2.allocation.shown, p2.allocation.complete], [2, true]);
  assert.deepEqual([...p1.allocation.rows, ...p2.allocation.rows].map((x) => x.id), r.allocation.rows.map((x) => x.id), "the pages are the list");
  // one resident narrows
  const one = await householdApex({ read: "stakes", args: { handle: R0 } }, key, ctx);
  assert.equal(one.allocation.total, 4 + 5 + 7);
});

test("household { read: \"stakes\", handle }: a handle the key does not hold is refused, same code and words as the doorstep's reads, and no stranger's rows ride out (POS-1100 review)", { skip }, async () => {
  const r = await householdApex({ read: "stakes", args: { handle: STRANGER } }, key, ctx);
  assert.equal(r.code, 403, JSON.stringify(r).slice(0, 300));
  assert.equal(r.defect, `"${STRANGER}" is not one of your residents`);
  assert.match(r.hint, /your key acts for r000, r001/);
  assert.equal("allocation" in r, false);
  assert.equal(JSON.stringify(r).includes("r-stranger/their-mark"), false, "the stranger's stakes are not in the refusal");
  const held = await householdApex({ read: "stakes", args: { handle: R1 } }, key, ctx);
  assert.equal(held.allocation.total, 3 + 6 + 8, "a resident the key does hold is read as before");
});

test("household { read_shape: \"v2\" }: the glance's stamps block carries the aggregate, equal to its own staked, and never the list", { skip }, async () => {
  const g = await householdApex({ read_shape: "v2", handle: R0 }, key, ctx);
  assert.equal(g.read_shape, "v2", JSON.stringify(g).slice(0, 300));
  assert.ok(g.stamps.stakes, JSON.stringify(g.stamps));
  assert.equal(g.stamps.stakes.unavailable, undefined, g.stamps.stakes.unavailable);
  assert.equal(g.stamps.stakes.total, HOUSE_STAKED, "the aggregate's total is the ledger's");
  assert.equal(g.stamps.staked, g.stamps.stakes.total, "and it is the glance's own `staked`, the store's copy of the same figure");
  assert.equal(g.stamps.stakes.count, 6);
  // the per-kind counts are the glance's whole account of the list: they add up to the count, name only known kinds, and no row's id rides anywhere in the block
  const kinds = Object.entries(g.stamps.stakes.by_kind);
  assert.ok(kinds.length > 0 && kinds.every(([k, n]) => STAKE_KINDS.includes(k) && Number.isInteger(n) && n > 0), JSON.stringify(g.stamps.stakes.by_kind));
  assert.equal(kinds.reduce((n, [, c]) => n + c, 0), g.stamps.stakes.count, "the counts per kind are the whole count");
  for (const id of ["r000/own-mark", "r000/an-idea", "fixture-pot", "fixture-topic/fixture-c", "r-stranger/their-idea"])
    assert.equal(JSON.stringify(g.stamps).includes(id), false, `the glance never carries a row: ${id} is in its stamps block`);
  assert.ok(Object.keys(g.stamps.stakes).every((k) => ["at_risk", "by_kind", "count", "kind_note", "list", "total"].includes(k)), `only the aggregate's own keys: ${Object.keys(g.stamps.stakes)}`);
  assert.equal("rows" in g.stamps.stakes, false, "never the list");
  assert.equal(g.stamps.stakes.list, 'household { read: "stakes" }');
  const { unexplained } = await import("../src/read-grammar.mjs");
  assert.deepEqual(unexplained("household", g, 2), [], "every key is explained");
});

test("the finished doorstep's stakes item carries the read's own first page on both skins, counting the post stakes, and IS the read at its args", { skip }, async () => {
  for (const slim of [false, true]) {
    const d = await doorstepBundle(R0, { key: null, asOf: AS_OF, canWrite: false, clone: scratch, pen: null, odb: null, slim });
    assert.equal(d.stakes.allocation?.unavailable, undefined, d.stakes.allocation?.unavailable);
    assert.equal(d.stakes.allocation.total, 4 + 5 + 7, `${slim ? "slim" : "full"}: r000's own stamps behind marks, posts and the pot`);
    assert.equal(d.stakes.allocation.count, 3);
    assert.deepEqual(d.stakes.args, { handle: R0, limit: 10 }, "when it is there the pointer names the page it is");
    assert.deepEqual(d.stakes.allocation.rows.map((x) => x.id).sort(), ["fixture-pot", "r000/an-idea", "r000/own-mark"]);
    const read = await householdApex({ read: "stakes", args: d.stakes.args }, { household: HOUSE, handles: new Set([R0]) }, ctx);
    assert.deepEqual(d.stakes.allocation, read.allocation, "the segment is the read at its args, the bundle's law");
  }
});
