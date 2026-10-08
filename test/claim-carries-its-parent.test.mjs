// claim-carries-its-parent.test.mjs — a predicate or naming claim names its
// parent ON THE ROW (POS-446, 2026-10-08).
//
//   node --test test/claim-carries-its-parent.test.mjs
//
// THE INSTANCE. quill-stem's naming mark "the sixth book" (window 169) stands in
// the store with `parent` NULL, while its data says `parent_id:
// neth/little-free-library` and its file is filed under that library. The pen
// wrote the parent into `data.parent_id` only, and the clearing copies
// `claims.parent` and nothing else (materialize.mjs). Measured read-only on prod:
// of the door's naming claims since window 151, 0 of 18 carry `parent`; of its
// predicated claims, 1 of 23 (and that one is marks-ingest's, not the door's).
//
// THE RIG is amend-chains-to-the-standing-mark's: a scripted client that answers
// by the SQL's shape and records the parameters of the write, no Postgres.

import { test } from "node:test";
import assert from "node:assert/strict";
import { claimTxFromJournal } from "../src/world2-claims.mjs";

function scriptedClient({ standing = {}, draft = false } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      log.push({ text, params });
      if (text.startsWith("SELECT pg_advisory_xact_lock_shared(")) return { rows: [{}], rowCount: 1 };
      if (text.includes("FROM windows")) return { rows: [{ id: 237 }], rowCount: 1 };
      if (text.includes("FROM marks WHERE slug") && text.includes("status = 'standing'")) {
        const id = standing[params[0]] ?? null;
        return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
      }
      if (text.startsWith("UPDATE claims SET status = 'retracted'")) return { rows: [], rowCount: 0 };
      if (text.startsWith("UPDATE claims SET")) return { rows: draft ? [{ id: "claim-draft" }] : [], rowCount: draft ? 1 : 0 };
      if (text.startsWith("INSERT INTO claims")) return { rows: [], rowCount: 1 };
      if (text.includes("household_spellings") || text.includes("FROM households")) return { rows: [], rowCount: 0 };
      throw new Error(`unscripted query: ${text.slice(0, 80)}`);
    },
  };
}

const LIBRARY = "d8624a65-0b0a-5552-a25f-1e156395a069";   // neth/little-free-library's id on prod
const naming = (over = {}) => ({
  action: "leave-mark", actor: "quill-stem", object: "quill-stem/the-fitting-room",
  payload: JSON.stringify({ slug: "the-fitting-room", kind: "naming", by: "quill-stem", parent_id: "neth/little-free-library",
    value: "a room with no audience, where shapes are tried on until one fits.", body: "the sixth book.", put_forward: true, ...over }),
});
const insertOf = (client) => {
  const ins = client.log.find((q) => q.text.startsWith("INSERT INTO claims"));
  assert.ok(ins, "the pen reached the claim INSERT");
  assert.match(ins.text, /\bparent\)/, "the INSERT names the parent column");
  return ins.params;
};

test("a naming claim carries its standing parent's id in `parent`, not only in data", async () => {
  const client = scriptedClient({ standing: { "neth/little-free-library": LIBRARY } });
  await claimTxFromJournal(client, naming(), 975, { household: "solo:quill-stem" });
  const p = insertOf(client);
  assert.equal(p[12], LIBRARY, "$13 = parent: the library's mark id, which the clearing copies to marks.parent");
  assert.match(p[9], /"parent_id":"neth\/little-free-library"/, "and data keeps the resident's own word beside it");
  // ⚑ THE FLIP: drop `parent` from the INSERT and this reads undefined — the row
  //   quill-stem's mark materialized from at window 169.
});

test("a predicated claim does the same", async () => {
  const client = scriptedClient({ standing: { "lu-yu/yu-tai": "74be4b7c-41c4-4093-ba18-2ee8fb80c889" } });
  await claimTxFromJournal(client, {
    action: "leave-mark", actor: "lu-yu", object: "lu-yu/to-the-high-ground",
    payload: JSON.stringify({ slug: "to-the-high-ground", kind: "predicated", by: "lu-yu", parent_id: "lu-yu/yu-tai",
      slot: "到东边那片高地", value: "三千二百零八步", body: "从舆台起往东。", put_forward: true }),
  }, 2001, { household: "gh:1" });
  assert.equal(insertOf(client)[12], "74be4b7c-41c4-4093-ba18-2ee8fb80c889");
});

test("a parent that is not STANDING is left NULL — a claim may not point at a row that might be refused", async () => {
  const client = scriptedClient({ standing: {} });
  await claimTxFromJournal(client, naming(), 976, { household: "solo:quill-stem" });
  assert.equal(insertOf(client)[12], null);
});

test("a sited mark's parent_id is a placement hint, never the continuation edge — no lookup, NULL", async () => {
  const client = scriptedClient({ standing: { "berthillon/le-petit-berthillon": "shop" } });
  await claimTxFromJournal(client, {
    action: "leave-mark", actor: "berthillon", object: "berthillon/cone-x",
    payload: JSON.stringify({ slug: "cone-x", kind: "sited", by: "berthillon", parent_id: "berthillon/le-petit-berthillon",
      at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 }, body: "a cone", put_forward: true }),
  }, 3001, { household: "gh:2" });
  assert.equal(insertOf(client)[12], null);
  assert.ok(!client.log.some((q) => q.text.includes("FROM marks WHERE slug")), "a sited leave never looks a mark up");
});

test("a draft promoted to pending writes the parent in the same UPDATE", async () => {
  const client = scriptedClient({ standing: { "neth/little-free-library": LIBRARY }, draft: true });
  await claimTxFromJournal(client, naming(), 977, { household: "solo:quill-stem" });
  const upd = client.log.find((q) => q.text.startsWith("UPDATE claims SET status = $12"));
  assert.ok(upd, "the promotion ran");
  assert.match(upd.text, /parent = \$13/);
  assert.equal(upd.params[12], LIBRARY);
});
