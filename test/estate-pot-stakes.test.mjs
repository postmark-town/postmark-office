// estate-pot-stakes.test.mjs — THE ESTATE'S ESCROW SPLIT READS THE INDEX, BYTE
// FOR BYTE (Linear POS-718, 2026-10-19).
//
//   node --test test/estate-pot-stakes.test.mjs
//
// THE DEFECT: `household { read: "stamps" }` (household-stamps.mjs §
// estateRead) read the town's whole stamp ledger (~5 MB, 23K lines on prod)
// and folded it on every call, for one per-handle map: each resident's open pot
// stakes. The index already holds that map. town-index.mjs § fundingRows writes
// foldFunding's own `potEscrowByHandle` into town_pot_stakers, and the ingest
// re-derives it whenever the ledger moves. So the estate reads it from there
// (town-index-store.mjs § potStakes).
//
// THE GOLDEN: the pinned town clone's REAL ledger is folded the ingest's way
// into a fresh store. The estate is then asked twice for every resident who
// holds or ever held a pot stake: once through the store (the read as shipped),
// and once through the fold the read used to run, verbatim (the whole ledger
// file, parseLedgerText, foldFunding). The two answers must be the same bytes,
// key order included. A positive control requires that some resident's
// `by_pot` is not empty, so an answer with every split empty cannot pass by
// being blank on both sides.
//
// CAN FAIL: make potStakes answer an empty Map, or drop a row (the SQL's
// WHERE), and the bytes differ on the first staker.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { townClone } from "./fixture-paths.mjs";
import { fundingRows } from "../src/town-index.mjs";
import { foldFunding, parseLedgerText } from "../src/funding.mjs";
import * as store from "../src/town-index-store.mjs";
import { estateRead } from "../src/household-stamps.mjs";

const TOWN = townClone();
const LEDGER = TOWN ? join(TOWN, "WHITE_PAGES", "stamp-ledger.md") : null;
let s = null, api = null, skip = LEDGER && existsSync(LEDGER) ? false : "no town clone with a stamp ledger beside the office";
let stakers = [];

before(async () => {
  if (skip) return;
  s = await startStore({ db: "estate_pot_stakes" });
  if (s.skip) { skip = s.skip; return; }
  // the fixture town's rows, with every funding table replaced by the real ledger's, folded as the ingest folds it
  const db = fixtureTown();
  const funding = await fundingRows(TOWN, { log: { log() {}, warn() {} } });
  for (const [name, rows] of Object.entries(funding)) {
    db[name] = [];
    for (const r of rows) putValues(db, name, r);
  }
  stakers = [...new Set(funding.pot_stakers.map(([, handle]) => handle))].sort();
  const w = await s.connect("law_ingester");
  try { await seedTownIndex(w, db); } finally { await w.end(); }
  api = await s.connect("office_api");
});

after(async () => {
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
});

// the read before POS-718: the whole ledger, folded on every call
const foldedFromTheFile = async () => foldFunding(parseLedgerText(readFileSync(LEDGER, "utf8"))).potEscrowByHandle ?? new Map();

test("the estate's escrow split from the index is the whole-ledger fold's, byte for byte", async (t) => {
  if (skip) return t.skip(skip);
  assert.ok(stakers.length >= 2, `the real ledger holds open pot stakes to compare (found ${stakers.length})`);
  // everyone with an open pot stake, two residents whose stakes all came home (wright, rei), and one with nothing
  const handles = [...new Set([...stakers, "wright", "rei", "nobody-at-all"])];
  const key = { household: "golden", handles: new Set(handles) };
  const ix = store.storeIndex(api, TOWN);
  const fromStore = await estateRead(key, { ix });
  const fromFile = await estateRead(key, { ix: { ...ix, potStakes: foldedFromTheFile } });
  assert.equal(JSON.stringify(fromStore), JSON.stringify(fromFile), "the same bytes from the index as from the fold of the whole ledger");
  const split = fromStore.residents.filter((r) => r.escrow.by_pot.length);
  assert.ok(split.length >= 2, "positive control: residents with open pot stakes show them");
  assert.deepEqual(split.map((r) => r.handle).sort(), stakers, "every staker in the index is shown, and nobody else");
});

test("the pooled index (the door's) answers each staker's stakes as the fold does", async (t) => {
  if (skip) return t.skip(skip);
  const pooled = store.storeIndexPooled(TOWN, { env: { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") } });
  const one = await pooled.potStakes(stakers);
  const fold = await foldedFromTheFile();
  assert.deepEqual([...one.keys()].sort(), stakers);
  for (const h of stakers) assert.deepEqual(Object.fromEntries(one.get(h)), Object.fromEntries([...fold.get(h)].filter(([, n]) => n > 0)), `${h}: the index's stakes are the fold's`);
});
