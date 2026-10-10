// law-pin-forward.test.mjs — THE LAW PIN NEVER MOVES BACKWARDS (POS-364 review, 2026-10-08).
//
// The law unit reads the newest settlement's law (deploy/world2-ingest.sh), and
// its first run after the deploy would move projection_heads['world-law'] from
// world main back to the last settlement. writeLaw moves the pin only to a
// descendant of where it stands; otherwise it writes the rows and holds the pin.
//
//   node --test test/law-pin-forward.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";
import { pinMove, writeLaw, LAW_REPO_KEY } from "../world2/tools/law-ingest.mjs";

const store = await startStore({ db: "law_pin_forward_test" });

/** A scratch repo with a line of history: settlement S99 is an ancestor of main. */
function history(t) {
  const dir = mkdtempSync(join(tmpdir(), "law-pin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  g("init", "-q");
  const commit = (n) => { writeFileSync(join(dir, "f"), n); g("add", "f"); g("commit", "-qm", n); return g("rev-parse", "HEAD"); };
  const s99 = commit("S99"), main = commit("main"), s100 = commit("S100");
  const isAncestor = (a, b) => { try { g("merge-base", "--is-ancestor", a, b); return true; } catch (e) { if (e.status === 1) return false; throw e; } };
  return { s99, main, s100, isAncestor };
}

const pin = async () => {
  const c = await store.connect("world2_owner");
  try { return (await c.query("SELECT sha FROM projection_heads WHERE repo = $1", [LAW_REPO_KEY])).rows[0]?.sha ?? null; } finally { await c.end(); }
};
const ingest = async (sha, isAncestor) => {
  const c = await store.connect("law_ingester");
  try { return await writeLaw(c, { lawSha: sha, rows: [], isAncestor }); } finally { await c.end(); }
};

test("pinMove: forward to a descendant, never back; an unplaceable pin is held", (t) => {
  const h = history(t);
  assert.equal(pinMove(null, h.s99, h.isAncestor).move, true, "no pin yet");
  assert.equal(pinMove(h.main, h.main, h.isAncestor).move, true, "the same sha");
  assert.equal(pinMove(h.main, h.s100, h.isAncestor).move, true, "a descendant");
  assert.equal(pinMove(h.main, h.s99, h.isAncestor).move, false, "an ancestor: backwards");
  assert.equal(pinMove(h.main, h.s99, null).move, false, "no way to tell: held");
  assert.equal(pinMove(h.main, "f".repeat(40), h.isAncestor).move, false, "a sha the checkout cannot place: held");
});

test("writeLaw: the deploy's first run holds the pin at main; the next settlement past main moves it", async (t) => {
  const h = history(t);
  const owner = await store.connect("world2_owner");
  try { await owner.query("DELETE FROM projection_heads WHERE repo = $1", [LAW_REPO_KEY]); } finally { await owner.end(); }
  assert.equal((await ingest(h.main, h.isAncestor)).pin, "moved");
  assert.equal(await pin(), h.main);
  const held = await ingest(h.s99, h.isAncestor);
  assert.equal(held.pin, "held", "S99 is behind the pin");
  assert.equal(held.current, h.main);
  assert.equal(await pin(), h.main, "the clearing keeps main's rulebook");
  assert.equal((await ingest(h.s100, h.isAncestor)).pin, "moved");
  assert.equal(await pin(), h.s100, "the first settlement past main moves it");
});

test.after(async () => { await store.stop(); });
