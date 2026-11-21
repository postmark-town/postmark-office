// pos-1086-doorstep-rev.test.mjs — a doorstep's content revision (POS-1086).
//
// LAW: "the revision is the content". `rev` hashes the composed doorstep body
// with the five global as_of-derived leaves taken out (src/doorstep-rev.mjs), so
// a caller told "unchanged" holds the same bytes modulo those five leaves.
//
// MEASURED, 2026-11-17 14:55Z-15:07Z on prod's public /doorsteps (read-only):
// across an idle resident's two reads exactly five leaves differed (as_of,
// copy.newest_change_at, copy.sentence, window.freshness.settled_as_of,
// pending_outbox_freshness.settled_as_of); a resident's own content (a stance)
// moved 762 leaves with as_of unmoved.
//
// This file composes REAL doorsteps in process (doorstepBundle over the fixture
// town) at two copies of the record, and holds the strip list to the leaves that
// actually differ, so a sixth global leaf added to the page reddens here.
//   node --test test/pos-1086-doorstep-rev.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { GLOBAL_LEAVES, GLOBAL_VERSION, TOWN_WIDE_BLOCKS, REV_RE, revOf, splitGlobal, withRev, parseKnown } from "../src/doorstep-rev.mjs";

delete process.env.TOWN_PUSH;
const IX = await indexStore(fixtureTown(), { db: "pos1086_rev" });
const RESTORE = await IX.useInProcess();
test.after(async () => { await RESTORE(); await IX.stop(); });
const tis = await import("../src/town-index-store.mjs");
const storeIx = () => tis.storeIndexPooled(null);

const NOW = Date.parse("2026-07-12T09:30:00Z");
const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// the doorstep of one resident, composed against a copy of the record at `asOf` whose newest change is `newest`.
// The fixture store always reads one commit, so the store's own `as_of` (the page's header, which the live store
// takes from the copy it indexed) is set to `asOf` here; everything else is the real composition.
async function doorstepAt(handle, asOf, newest) {
  const real = storeIx();
  // the page's town-index reads are one lease since POS-1129 (town-index-store.mjs § doorstepPage): its core and its copy are what this stands in for.
  // Until 2026-11-18 this overrode `ix.doorstep` and `ix.copy`, which the bundle read on their own leases then.
  const ix = {
    ...real,
    doorstepPage: async (...a) => {
      const p = await real.doorstepPage(...a);
      if (!p) return p;
      const c = p.core;
      return {
        ...p,
        // the store at another commit: every place the page names its commit names the new one
        core: c && JSON.parse(JSON.stringify(c).replaceAll(c.as_of, asOf)),
        copy: p.copy.e ? p.copy : { v: { ...p.copy.v, newest } },
      };
    },
  };
  return doorstepBundle(handle, { key: null, asOf, canWrite: false, clone: null, odb: null, ix, nowMs: NOW });
}

// every leaf path of a JSON value, arrays by index, with the value
function leaves(v, p = "", out = new Map()) {
  if (Array.isArray(v)) { out.set(`${p}#len`, v.length); v.forEach((x, i) => leaves(x, `${p}[${i}]`, out)); }
  else if (v && typeof v === "object") for (const k of Object.keys(v)) leaves(v[k], p ? `${p}.${k}` : k, out);
  else out.set(p, v);
  return out;
}
const differing = (x, y) => {
  const a = leaves(x), b = leaves(y);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).sort();
};

test("LAW: only the five as_of-derived leaves differ between a doorstep composed at two copies of the record", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const y = await doorstepAt("wright", B, "2026-07-12T09:10:00.000Z");
  assert.ok(leaves(x).size > 100, "a real, whole doorstep was composed");
  assert.deepEqual(differing(x, y), [...GLOBAL_LEAVES].sort(),
    "exactly the stripped leaves move with the copy alone, none fewer (a dead strip) and none more (a sixth global leaf the rev would then track)");
});

test("LAW: the revision is the content: two copies of the record, one rev; one changed leaf, another rev", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const y = await doorstepAt("wright", B, "2026-07-12T09:10:00.000Z");
  assert.match(revOf(x), REV_RE);
  assert.equal(revOf(x), revOf(y), "the five global leaves are not in the revision");
  // a content leaf moves the revision: each of several real segments, one at a time
  for (const [seg, mutate] of [
    ["mail", (d) => { d.mail.box = `${d.mail.box}!`; }],
    ["stances", (d) => { d.stances.stances_awaiting = (d.stances.stances_awaiting ?? 0) + 1; }],
    ["stakes", (d) => { d.stakes.count = (d.stakes.count ?? 0) + 1; }],
    ["counts", (d) => { d.counts.received += 1; }],
    ["the build's constants (a deploy)", (d) => { d.doorstep_version += "!"; }],
  ]) {
    const z = JSON.parse(JSON.stringify(x));
    mutate(z);
    assert.notEqual(revOf(z), revOf(x), `a changed ${seg} leaf moves the revision`);
  }
  // another resident's page is another revision
  assert.notEqual(revOf(await doorstepAt("limen", A, "2026-07-12T09:00:00.000Z")), revOf(x));
});

test("the revision does not depend on key order, and never on an existing rev", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const reversed = Object.fromEntries(Object.entries(x).reverse());
  assert.equal(revOf(reversed), revOf(x));
  assert.equal(revOf(withRev(x)), revOf(x), "a body that already carries rev hashes as it did");
  assert.equal(Object.keys(withRev(x)).at(-1), "rev", "rev is appended, nothing before it moves");
  assert.deepEqual({ ...withRev(x), rev: undefined }, { ...x, rev: undefined });
  assert.equal(withRev(null), null, "a 404's row stays null");
});

test("splitGlobal hands back the five leaves' values and a body without them, leaving its input whole", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const before = JSON.stringify(x);
  const { rest, global } = splitGlobal(x);
  assert.equal(JSON.stringify(x), before, "the input is not changed");
  assert.equal(global.as_of, A);
  assert.equal(global.copy.newest_change_at, "2026-07-12T09:00:00.000Z");
  assert.equal(global.copy.sentence, x.copy.sentence);
  assert.equal(global.window_settled_as_of, x.window.freshness.settled_as_of);
  assert.equal(global.outbox_settled_as_of, x.pending_outbox_freshness.settled_as_of);
  assert.equal(global.window_settled_as_of, A, "the window's freshness stamp is the same as_of");
  assert.equal(global.outbox_settled_as_of, A, "the outbox tense's stamp is the same as_of");
  assert.equal("as_of" in rest, false);
  assert.equal("copy" in rest, false, "copy is a town-wide block, taken out whole");
  assert.equal("settled_as_of" in rest.window.freshness, false);
  assert.equal("settled_as_of" in rest.pending_outbox_freshness, false);
  // patching the leaves and the blocks back reproduces the body, byte for byte: what a site does with a carried-over file
  const patched = JSON.parse(JSON.stringify(rest));
  patched.as_of = global.as_of;
  patched.window.freshness.settled_as_of = global.window_settled_as_of;
  patched.pending_outbox_freshness.settled_as_of = global.outbox_settled_as_of;
  for (const k of TOWN_WIDE_BLOCKS) patched[k] = global.town_wide[k];
  assert.equal(revOf(patched), revOf(x));
  assert.deepEqual(differing(patched, x), []);
});

test("splitGlobal's whole output equals the one-pass reference (a whole second clone of the page was the old way)", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  // the reference: delete the five leaves from a clone, then take the blocks out of that body and out of a SECOND whole clone of the page
  const clone = () => JSON.parse(JSON.stringify(x));
  const { rev: _rev, ...body } = clone();
  const global = {
    as_of: body.as_of ?? null,
    copy: { newest_change_at: body.copy?.newest_change_at ?? null, sentence: body.copy?.sentence ?? null },
    window_settled_as_of: body.window?.freshness?.settled_as_of ?? null,
    outbox_settled_as_of: body.pending_outbox_freshness?.settled_as_of ?? null,
  };
  delete body.as_of; delete body.copy.newest_change_at; delete body.copy.sentence;
  delete body.window.freshness.settled_as_of; delete body.pending_outbox_freshness.settled_as_of;
  const second = clone();
  const townWide = {};
  for (const k of TOWN_WIDE_BLOCKS) if (k in body) { townWide[k] = second[k]; delete body[k]; }
  global.version = GLOBAL_VERSION;
  global.town_wide = townWide;
  const got = splitGlobal(x);
  assert.equal(JSON.stringify(got), JSON.stringify({ rest: body, global }), "rest and global, key order and all, as before");
  assert.equal(JSON.stringify(splitGlobal(withRev(x))), JSON.stringify(got), "a body carrying rev splits the same");
});

// ── GLOBAL-BLOCKS: the town-wide blocks are out of the rev and ride `global` ──────────────────────────────────────────────

test("global carries a version and every town-wide block whole, and each block is the page's own", async () => {
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const { global } = splitGlobal(x);
  assert.equal(global.version, GLOBAL_VERSION);
  assert.deepEqual(Object.keys(global.town_wide), [...TOWN_WIDE_BLOCKS].sort((a, b) => Object.keys(x).indexOf(a) - Object.keys(x).indexOf(b)), "every block, in the page's order");
  for (const k of TOWN_WIDE_BLOCKS) assert.deepEqual(global.town_wide[k], x[k], `${k} is carried exactly as the page holds it`);
  assert.ok(Object.keys(x.bulletin).length && Object.keys(x.town_pulse).length, "the bulletin and the pulse are real blocks, not empty");
});

test("every town-wide block is the same for two residents, and every other moving top-level key is not asserted here", async () => {
  // FLIP: add a resident-dependent key (e.g. "counts" or "mail") to TOWN_WIDE_BLOCKS and this goes red.
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  const y = await doorstepAt("limen", A, "2026-07-12T09:00:00.000Z");
  for (const k of TOWN_WIDE_BLOCKS) assert.deepEqual(y[k], x[k], `${k} reads no resident input`);
  for (const k of ["mail", "awaiting", "stamps", "window", "counts"]) assert.notDeepEqual(y[k], x[k], `${k} is the resident's own, so it stays in the rev`);
});

test("the revision does not move when only a town-wide block moves; it moves when the resident's own content does", async () => {
  // FLIP: delete `delete body[k]` for the blocks in splitGlobal (src/doorstep-rev.mjs) and every block's case below goes red.
  const x = await doorstepAt("wright", A, "2026-07-12T09:00:00.000Z");
  for (const [k, mutate] of [
    ["copy", (d) => { d.copy.caught_up = !d.copy.caught_up; d.copy.last_crossing_by_timetable += 1; }],
    ["next_crossing", (d) => { d.next_crossing.crossing += 1; }],
    ["bulletin", (d) => { d.bulletin.total = (d.bulletin.total ?? 0) + 1; }],
    ["town_pulse", (d) => { d.town_pulse = { ...d.town_pulse, moved: true }; }],
    ["psa", (d) => { d.psa.entries = []; d.psa.note = "moved"; }],
    ["town", (d) => { d.town.deliveries += 1; }],
  ]) {
    const z = JSON.parse(JSON.stringify(x));
    mutate(z);
    assert.notDeepEqual(z[k], x[k], `${k} was really changed`);
    assert.equal(revOf(z), revOf(x), `a moved ${k} block does not move the revision`);
  }
  const own = JSON.parse(JSON.stringify(x));
  own.mail.box = `${own.mail.box}!`;
  assert.notEqual(revOf(own), revOf(x), "the resident's own content still does");
  const gone = JSON.parse(JSON.stringify(x));
  delete gone.psa;
  assert.notEqual(revOf(gone), revOf(x), "a page missing a block is another page, not the same revision");
});

test("parseKnown takes handle:rev pairs and names the first bad one", () => {
  const ok = parseKnown(["wright:0123456789abcdef", "limen:fedcba9876543210"]);
  assert.deepEqual([...ok.known], [["wright", "0123456789abcdef"], ["limen", "fedcba9876543210"]]);
  for (const bad of ["wright", "wright:xyz", "wright:0123456789ABCDEF", "Wright:0123456789abcdef", "wright:0123456789abcde", "../x:0123456789abcdef"])
    assert.equal(parseKnown(["limen:fedcba9876543210", bad]).refused, bad.slice(0, 60), bad);
});
