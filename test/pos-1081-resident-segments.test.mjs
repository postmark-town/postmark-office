// pos-1081-resident-segments.test.mjs — POS-1081: the house read's per-resident segments load under the pen lease and compose after it.
//
// LAW (Darko, 2026-11-16 09:46 EST, on the ruling that staffed this): "Just build it via direct lane" — for the ask on POS-1081: "load what the doorstep needs under the
// lease, release it, then compose outside it, so the pen isn't held while JavaScript runs between statements. The same answers."
//
// WHAT THIS HOLDS
//   1. THE SAME ANSWERS. `storeIndexPooled(..).residentSegments` (rows under the connection, composition after it) is compared, byte for byte, against the one-pass reading
//      `residentSegments` was before POS-1081 (kept verbatim below as OLD, read through `readTownIndex`): for residents of houses of one, two and four, an inbox past the
//      bound of 20, an awaiting law, a standing letter, a resident with no card and one whose card does not parse (the same error, now thrown after the release).
//   2. THE BOUNDARY (the falsifier, red on the one-pass reader). The JSON this call parses is parsed with NO pen connection held (the driver's own parsing inside a
//      statement excluded), no statement is issued on a connection after it was released, and none is left out. The OLD reading, run through the same instrument, parses
//      while the pen holds its transaction: the control that the instrument can see it.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1081-resident-segments.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fixtureTown, put } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { penHeld, storePoolOptions } from "../src/store-pool.mjs";
import {
  readTownIndex, storeIndexPooled, __setTownIndexPoolForTest,
  mailList, mailAwaiting, stampsDetail, windowRead, outboxSettled,
} from "../src/town-index-store.mjs";
import { residentSegmentsOf, DOORSTEP_INBOX } from "../src/house-bundle.mjs";

const REGISTRY = { schema_version: 1, note: "invented for POS-1081", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "wright", accounts: [{ login: "ember-gh", id: 8101 }], residents: ["wright", "limen"] },
  "pine-row": { name: "Pine Row", since: "2026-08-02", declared_by: "solo", accounts: [{ login: "pine-gh", id: 8102 }], residents: ["solo"] },
  "harbor-four": { name: "Harbor Four", since: "2026-08-03", declared_by: "bigmail", accounts: [{ login: "harbor-gh", id: 8103 }], residents: ["bigmail", "kit", "moss", "reed"] },
} };
const PINS = {
  wright: { login: "ember-gh", id: 8101 }, limen: { login: "ember-gh", id: 8101 }, solo: { login: "pine-gh", id: 8102 },
  bigmail: { login: "harbor-gh", id: 8103 }, kit: { login: "harbor-gh", id: 8103 }, moss: { login: "harbor-gh", id: 8103 }, reed: { login: "harbor-gh", id: 8103 },
};

/** The town: the fixture's, plus houses of one and four, an inbox of 45 letters (past the bound), funding rows for a party, and a card that does not parse. */
function town() {
  const t = fixtureTown();
  const card = (handle) => JSON.stringify({ handle, is_office: false, last_active: "2026-07-10T09:00:00.000Z",
    address: { data: { since: "2026-06-01", joined: "2026-06-02" }, body: `# ${handle}` },
    window_state: { handle, shown: `a window of ${handle}` } });
  for (const h of ["solo", "bigmail", "kit", "moss", "reed"]) put(t, "residents", { handle: h, json: card(h) });
  put(t, "residents", { handle: "bentcard", json: "{ this is not json" });
  for (const [h, bal] of [["solo", 2], ["bigmail", 9], ["kit", 1]]) put(t, "stamps", { handle: h, balance: bal, mint_count: bal, staked: 0 });
  for (let i = 1; i <= 45; i++) {
    const day = `2026-08-${String((i % 27) + 1).padStart(2, "0")}`;
    const id = `kit-${day}-to-bigmail-n${i}`;
    const at = `${day}T0${i % 9}:00:00.000Z`;
    put(t, "letters", { id, from_h: "kit", to_h: "bigmail", date: day, thread: null, box: "inbox", owner: "bigmail", path: `WHITE_PAGES/bigmail/inbox/${id}.md`,
      json: JSON.stringify({ id, from: "kit", to: "bigmail", date: day, thread: null, box: "inbox", body: `# Note ${i}\n\n${"A long line of a letter. ".repeat(30)}`, delivered_at: at }), delivered_at: at });
    put(t, "ledger", { kind: "delivery", date: day, id, from_h: "kit", to_h: "bigmail", json: "{}" });
  }
  put(t, "funding_holo", { party: "harbor-four", pot: "the-lamp", holo: 3, epoch: 1, date: "2026-08-04", receipt: "r-1" });
  put(t, "funding_holo", { party: "ember-lane", pot: "the-lamp", holo: 2, epoch: 1, date: "2026-08-05", receipt: "r-2" });
  put(t, "funding_keeping_mint", { party: "harbor-four", pot: "the-lamp", n: 1, epoch: 1, date: "2026-08-06" });
  put(t, "pot_receipts", { pot: "the-lamp", rail: "stamps", usd: 5, date: "2026-08-04", receipt: "r-1", payer: "kit" });
  return t;
}

let ix = null, penPool = null;
const checkouts = { open: 0, afterRelease: 0, leases: 0 };

before(async () => {
  ix = await indexStore(town(), { db: "pos1081_segments" });
  await seedRegistry(ix.store, REGISTRY, PINS);
  const { default: pg } = await import("pg");
  penPool = new pg.Pool(storePoolOptions({ ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: ix.env.WORLD2_PG_URL }, { name: "pen", max: 3 }));
  penPool.on("error", () => {});
  const connect = penPool.connect.bind(penPool);
  penPool.connect = async (...a) => {
    const c = await connect(...a);
    checkouts.open += 1; checkouts.leases += 1;
    // a pooled client is reused, and the pool hands it a fresh `release` at every checkout: wrap that one each time, and `query` once
    c.__out = true;
    const release = c.release.bind(c);
    c.release = (...r) => { checkouts.open -= 1; c.__out = false; return release(...r); };
    if (!c.__wrapped) {
      c.__wrapped = true;
      const query = c.query.bind(c);
      c.query = (...q) => { if (!c.__out) checkouts.afterRelease += 1; return query(...q); };
    }
    return c;
  };
  __setTownIndexPoolForTest(penPool);
});

after(async () => {
  __setTownIndexPoolForTest(null);
  await penPool?.end().catch(() => {});
  await ix?.stop();
});

/** residentSegments as it read before POS-1081: every reader, composition and all, inside the one READ ONLY transaction. Kept verbatim as the oracle. */
async function OLD(q, handle, fresh, standing = null) {
  const one = async (sql, params) => Number((await q.query(sql, params)).rows[0].n);
  return residentSegmentsOf({
    mail: await mailList(q, handle, "inbox", { limit: DOORSTEP_INBOX }),
    awaiting: await mailAwaiting(q, handle, { offset: 0, standing }),
    stamps: await stampsDetail(q, handle),
    window: await windowRead(q, handle, fresh),
    pendingOutbox: await outboxSettled(q, handle),
    counts: {
      received: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND to_h = $1", [handle]),
      sent: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND from_h = $1", [handle]),
    },
  }, handle);
}
const oldAnswer = async (handle, fresh, standing) => (await readTownIndex((c) => OLD(c, handle, fresh, standing))).out;
const newAnswer = (handle, fresh, standing) => storeIndexPooled(null).residentSegments(handle, fresh, standing);
const settle = async (p) => { try { return { ok: JSON.stringify(await p) }; } catch (e) { return { threw: `${e.name}: ${e.message}` }; } };

test("THE SAME ANSWERS: the split reading is byte for byte the one-pass reading, for houses of one, two and four, a full inbox, a standing letter, no card and a bent card", async () => {
  const standingLetters = [{ letter_id: "wright-2026-08-01-to-limen-standing", thread: "limen-2026-07-01-to-wright-the-gap" }];
  const handles = ["wright", "limen", "postmaster", "solo", "bigmail", "kit", "moss", "reed", "nobody", "bentcard"];
  let compared = 0, threw = 0;
  for (const h of handles) for (const fresh of [{}, null, { clone: null }]) for (const standing of [null, standingLetters]) {
    const want = await settle(oldAnswer(h, fresh, standing));
    const got = await settle(newAnswer(h, fresh, standing));
    assert.deepEqual(got, want, `${h} fresh=${JSON.stringify(fresh)} standing=${standing ? "yes" : "no"}: the split reading answered differently`);
    compared += 1; if (want.threw) threw += 1;
  }
  assert.equal(compared, handles.length * 6);
  // the control that the comparison can tell answers apart: the cases really differ from each other, and the bent card really throws in both
  assert.ok(threw > 0 && threw < compared, `${threw} of ${compared} threw: the cases do not separate a throwing reader from a reading one`);
  const full = JSON.parse((await settle(newAnswer("bigmail", {}, null))).ok);
  assert.equal(full.mail.letters.length, DOORSTEP_INBOX, "the full inbox was not cut at the house read's bound");
  assert.ok(full.mail.total > DOORSTEP_INBOX, "the fixture's inbox is not past the bound");
  assert.equal(full.counts.received, 45, "the ledger's count did not come through");
  const solo = JSON.parse((await settle(newAnswer("solo", {}, null))).ok);
  assert.notDeepEqual(solo.stamps, full.stamps, "a house of one and a house of four read the same stamps: the funding rows are not reaching the reader");
});

/** Run `fn` and report the JSON the PAGE parsed while a pen connection was held (the driver's own parsing inside a statement is the statement's work). */
async function parsedWhileHeld(fn) {
  const held = [];
  let parses = 0;
  const real = JSON.parse;
  JSON.parse = function (text, ...r) {
    parses += 1;
    if (penHeld() && !/node_modules[\\/]pg[\\/]/.test(new Error().stack ?? "")) held.push(String(text).slice(0, 40));
    return real.call(this, text, ...r);
  };
  try { await fn(); } finally { JSON.parse = real; }
  return { held, parses };
}

test("THE BOUNDARY: the segments' composition parses no JSON while a pen connection is held, and no statement follows the release", async () => {
  for (const h of ["bigmail", "wright", "solo"]) {
    checkouts.afterRelease = 0; checkouts.leases = 0;
    const { held, parses } = await parsedWhileHeld(() => newAnswer(h, {}, null));
    assert.ok(parses > 0, `${h}: the segments parsed nothing: this test is not looking at what it claims to`);
    assert.deepEqual(held, [], `${h}: the segments parsed ${held.length} JSON text(s) while the pen held its transaction (the composition ran under the connection): ${JSON.stringify(held.slice(0, 3))}`);
    assert.equal(checkouts.afterRelease, 0, `${h}: a statement was issued on a pen connection after it was released`);
    assert.equal(checkouts.open, 0, `${h}: a pen connection was still out when the segments were composed`);
    assert.equal(checkouts.leases, 1, `${h}: the segments took ${checkouts.leases} pen connections; the rows are one snapshot, one lease`);
  }
});

test("THE CONTROL: the one-pass reading the split replaced does parse while the pen holds its transaction (the instrument sees the failure it guards)", async () => {
  const { held, parses } = await parsedWhileHeld(() => oldAnswer("bigmail", {}, null));
  assert.ok(parses > 0);
  assert.ok(held.length > 0, "the one-pass reading parsed nothing under the held connection: the boundary test above cannot fail");
});
