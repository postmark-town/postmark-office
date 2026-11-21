// placement-relations-door.test.mjs — POS-1156 on the door that runs: a sited placement, previewed or
// written, answers with `overlaps` and `contains` beside the `parent` it already names.
//
// Darko (CORE-124, 2026-11-19): "just so agents dont always have to spend two turns when creating a
// mark, can we just inform them without a separate confirmation step?" then "agreed with the shrink":
// the placement answer carries the two lists, no new act, no confirmation, one call.
//
// THE BOTTLE is world-journal.test.mjs's (the journal door over a hand-built store), with ONE
// difference that matters: the engine's `marks-fold.mjs` and `geometry.mjs` are the REAL ones, copied
// from the office's pinned world clone. A stub predicate would prove the door agrees with the stub.
//
//   node --test test/placement-relations-door.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { copyEngineFiles } from "./helpers/engine-closure.mjs";
import { ACTION_WITHDRAW, CLASS_MARK, resetPathIndex } from "../src/world-journal.mjs";

const CLONE = join(dirname(fileURLToPath(import.meta.url)), "..", "world-clone");
const have = existsSync(join(CLONE, "tools", "geometry.mjs")) && existsSync(join(CLONE, "tools", "marks-fold.mjs"));
const skip = !have && "no world-clone (the consumed engine is copied from it)";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const repo = tempDir("postmark-1156-repo-");
const scratch = tempDir("postmark-1156-db-");
after(() => { sweep(repo); sweep(scratch); });
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const record = (by, body) => `---\nkind: sited\nby: ${by}\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

// Canon. alpha's parcel is x 97.5..122.5, y 92.5..117.5; the town square (x 80..120) is the larger holder.
// The candidate is alpha's shed: x 105..115, y 100..110.
const sited = (id, x, y, w, h, extra = {}) => ({ id, by: id.split("/")[0], kind: "sited", tier: "market", at: { x, y }, extent: { w, h }, body: id, ...extra });
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the world frame" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 100, y: 100 }, extent: { w: 40, h: 40 }, body: "the square" },
  { id: "alpha/alpha-parcel", by: "alpha", kind: "parcel", tier: "home", household: "alpha", at: { x: 110, y: 105 }, extent: { w: 25, h: 25 }, body: "alpha's ground" },
  sited("alpha/the-bench", 112, 105, 2, 2),   // alpha's own mark, wholly inside the shed
  sited("beta/the-box", 108, 105, 6, 6),      // another house's mark, wholly inside the shed
  sited("alpha/the-crate", 107, 103, 2, 2),   // wholly inside the shed AND inside the box: held by the tighter box
  sited("beta/the-cart", 116, 105, 6, 6),     // sticks out of the shed
  sited("beta/far-hut", -300, -300, 4, 4),    // nowhere near
  sited("beta/edge-pot", 104, 105, 2, 2),     // its edge touches the shed's, no shared area
  // a crowd far from everything else: 47 small marks the over-forty control places a yard over
  ...Array.from({ length: 47 }, (_, i) => sited(`beta/spot-${String(i).padStart(2, "0")}`, 300 + (i % 10), 300 + Math.floor(i / 10), 0.5, 0.5)),
];

// ── the bottle's engine: the REAL fold and geometry, the stand-ins the door needs beside them ────────
if (have) copyEngineFiles(CLONE, repo, ["marks-fold.mjs", "geometry.mjs"]);
// THE ENGINE, in miniature, on main — the office materialises `tools/` at the
// published ref, so the door's own path can only be exercised if the fixture
// commits one. Faithful to the SHAPES the door reads, not to the world's
// arithmetic, which has its own suite.
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);

put("WORLD/households.json", JSON.stringify({ households: { alpha: "gh:1", beta: "gh:2" } }));
put("WORLD/marks/let-there-be-light/mark.md", record("the-town", "the world frame"));
// the legacy (flag-off) writer reads the clone's FILES, not the published state: every canon mark is filed too
const fileOf = (m) => `---\nkind: ${m.kind}\nby: ${m.by}\ndate: 2026-08-01\nat: { x: ${m.at.x}, y: ${m.at.y} }\nextent: { w: ${m.extent.w}, h: ${m.extent.h} }\n---\n\n${m.body}\n`;
for (const m of PUBLISHED.slice(1)) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`, fileOf(m));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: PUBLISHED, parcels: [{ id: "alpha/alpha-parcel", household: "alpha", at: { x: 110, y: 105 }, extent: { w: 25, h: 25 } }], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
put("WORLD/filing-freeze.json", JSON.stringify({ law: "Filing is frozen as of 2026-08-25.", source: "LOGOS/state-and-time.md", frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "placement falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// the office reads this clone as the world (set before world.mjs is first imported, below)
process.env.WORLD_CLONE = repo;

const houseA = { household: "alpha", handles: new Set(["alpha"]) };

let dbSeq = 0;
beforeEach(() => {
  process.env.WORLD_DYNAMIC_DB = join(scratch, `dynamic-${++dbSeq}.db`);
  process.env.WORLD_SINGLE_LOG = "1";
  resetPathIndex();
});
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const SHED = { slug: "the-shed", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 10, h: 10 }, body: "a shed on my own parcel" };
const ids = (rows) => (rows ?? []).map((r) => r.id);
const place = async (payload) => {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore();
  const out = await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, payload, houseA));
  return { out, store };
};

// What the shed lands among, by the engine's own predicates (see test/placement-relations.test.mjs for the rules).
const OVERLAPS = ["alpha/alpha-parcel", "alpha/the-bench", "alpha/the-crate", "beta/the-box", "beta/the-cart", "the-town/town-square"];
const CONTAINS = ["alpha/the-bench", "beta/the-box"];

test("PREVIEW names what the shed overlaps and contains, beside the parent it already names, and writes nothing", { skip }, async () => {
  const { out, store } = await place({ ...SHED, preview: true });
  assert.equal(out.preview, true);
  assert.equal(out.parent, "alpha/alpha-parcel", "the parent is what it always was: the smallest strictly larger holder");
  assert.deepEqual(ids(out.overlaps), OVERLAPS, "own marks, another house's marks and the holders are named; the far hut and the touching pot are not");
  assert.deepEqual(ids(out.contains), CONTAINS, "own mark and another house's mark, not the crate the tighter box holds");
  assert.deepEqual(out.contains.map((r) => r.household), ["alpha-house", "beta-house"], "each carries its public household");
  assert.deepEqual(out.overlaps.find((r) => r.id === "beta/the-cart"), { id: "beta/the-cart", name: "the Cart", household: "beta-house" });
  assert.equal(store.acts.length, 0, "a preview writes no row");
  assert.equal(store.claims.length, 0, "…and files nothing on the docket");
  assert.equal(git("branch", "--list", "draft/alpha").trim(), "", "…and no branch");
});

test("the WRITE answers the same two lists for the same candidate and snapshot, in one call and one write", { skip }, async () => {
  const seen = await place({ ...SHED, preview: true });
  const { out, store } = await place({ ...SHED });
  assert.equal(out.preview, undefined, "the same call without preview is the write");
  assert.equal(out.parent, seen.out.parent);
  assert.deepEqual(out.overlaps, seen.out.overlaps, "the written answer reports what the preview reported");
  assert.deepEqual(out.contains, seen.out.contains);
  assert.equal(store.acts.length, 1, "one call, one existing write: nothing to confirm, no second act");
  assert.equal(out.seq, 1);
});

test("CAN-FAIL: a list that leaves out your own marks, or either list, is red here", { skip }, async () => {
  const { out } = await place({ ...SHED, preview: true });
  assert.ok(ids(out.overlaps).includes("alpha/the-bench") && ids(out.overlaps).includes("alpha/the-crate"), "your own marks are in overlaps");
  assert.ok(ids(out.contains).includes("alpha/the-bench"), "your own mark is in contains");
  assert.ok(Array.isArray(out.overlaps) && out.overlaps.length > 0, "overlaps is present");
  assert.ok(Array.isArray(out.contains) && out.contains.length > 0, "contains is present");
});

test("a placement the same size as its holder: the holder is not the parent (not strictly larger), and is still named as overlapping", { skip }, async () => {
  const { out } = await place({ slug: "the-twin-ground", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 25, h: 25 }, body: "the parcel's own footprint", preview: true });
  assert.equal(out.parent, "the-town/let-there-be-light", "an equal-size parcel does not hold it, and the square (x 80..120) does not hold a footprint that leaves it: the frame");
  assert.ok(ids(out.overlaps).includes("alpha/alpha-parcel"), "the equal-size parcel shares all its ground");
  assert.ok(!ids(out.contains).includes("alpha/alpha-parcel"), "and is not its child");
});

test("on ground that is not yours the answer still carries the lists; a placement that touches nothing says so with empty lists", { skip }, async () => {
  const far = await place({ slug: "next-to-the-hut", kind: "sited", at: { x: -300, y: -300 }, extent: { w: 4, h: 4 }, body: "on the hut's spot", stamps: 1, preview: true });
  assert.equal(far.out.preview, true);
  assert.deepEqual(ids(far.out.overlaps), ["beta/far-hut"]);
  assert.deepEqual(far.out.contains, []);
  const lone = await place({ slug: "out-in-the-open", kind: "sited", at: { x: 400, y: 400 }, extent: { w: 4, h: 4 }, body: "nothing near", stamps: 1, preview: true });
  assert.deepEqual(lone.out.overlaps, [], "read, and nothing touches it: an honest empty list");
  assert.deepEqual(lone.out.contains, []);
});

test("the flag-off (git) writer ships the SAME full rows as the journal path: id, name and public household", { skip }, async () => {
  const journal = await place({ ...SHED, preview: true });
  delete process.env.WORLD_SINGLE_LOG;
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  // the registry the door reads the public household from is the same hand-built store
  const out = await withGuardsFlipped(guardStore(), () => leaveMarkViaOffice(repo, { ...SHED, preview: true }, houseA));
  assert.equal(out.preview, true);
  assert.equal(out.parent, "alpha/alpha-parcel");
  assert.deepEqual(ids(out.overlaps), OVERLAPS);
  assert.deepEqual(ids(out.contains), CONTAINS);
  assert.deepEqual(out.overlaps, journal.out.overlaps, "whole rows, not ids alone: the same name and household as the journal writer");
  assert.deepEqual(out.contains, journal.out.contains);
  assert.deepEqual(out.contains.map((r) => r.household), ["alpha-house", "beta-house"]);
  assert.deepEqual(out.overlaps.find((r) => r.id === "beta/the-cart"), { id: "beta/the-cart", name: "the Cart", household: "beta-house" });
});

test("an answer past forty rows is returned whole on the door: no cutoff, no _more fields", { skip }, async () => {
  const { out } = await place({ slug: "the-yard", kind: "sited", at: { x: 305, y: 302 }, extent: { w: 20, h: 20 }, body: "a yard over the crowd", stamps: 1, preview: true });
  assert.equal(out.overlaps.length, 47);
  assert.equal(out.contains.length, 47);
  assert.equal("overlaps_more" in out || "contains_more" in out, false);
});

// ── the hand-built store (world-journal.test.mjs's, verbatim) ───────────────
const guardStore = ({ claims = [], identities = { alpha: "hh:alpha-house", beta: "hh:beta-house" }, scopeAs = (h) => h } = {}) => {
  // TWO SESSION SETTINGS since POS-160 RULING 4 — the store never re-spells a
  // row, so a house declares EVERY spelling it has ever carried and 024's four
  // draft policies compare against that set. `app.household` is still the one
  // current spelling, and `guard-reads.mjs § assertHouseholdDeclared` refuses a
  // guard read on a connection that declared only one of the two. The
  // `_keys` arm must be matched FIRST: `app.household` is a prefix of
  // `app.household_keys`, so a looser pattern would let the set clobber the key.
  let declared = null;
  let declaredKeys = null;
  const calls = { claims: 0 };
  const acts = [];
  let nextActId = 1;
  const self = {
    calls,
    acts,
    // The docket, exposed: a test that files a mark reads back the row the
    // door put on it, which is where an unstaked declaration lives.
    claims,
    client: {
      async query(sql, args = []) {
        if (/set_config\(.app\.household_keys./.test(sql)) {
          declaredKeys = args[0] ? String(args[0]).split(",") : null; return { rows: [{}] };
        }
        if (/set_config\(.app\.household./.test(sql)) { declared = args[0]; return { rows: [{}] }; }
        if (/current_setting\(.app\.household./.test(sql)) return { rows: [{ declared, keys: declaredKeys }] };
        // The drafts overlay's DELETED arm (guard-reads.mjs § WITHDRAW_ACT_SELECT):
        // withdraw acts by the house's residents, or under one of the names in $2.
        // Matched BEFORE the identities line, whose subquery it contains.
        if (/^SELECT/i.test(sql.trim()) && /FROM acts a/.test(sql) && /'withdraw'/.test(sql)) {
          const [keys, named] = args;
          const inHouse = (h) => (keys ?? []).includes(identities[h]);
          return { rows: acts.filter((a) => a.action === ACTION_WITHDRAW && a.class === CLASS_MARK
            && (inHouse(a.actor) || (named ?? []).includes(a.household))) };
        }
        if (/FROM identities/.test(sql)) return { rows: identities[args[0]] ? [{ household: identities[args[0]] }] : [] };
        // THE REGISTRY, which is what `householdKeyFor` reads since POS-160.
        // Same statement as the `identities` line above — these handles live in
        // these houses — in the vocabulary the resolver now asks in. The keys
        // are `hh:` because that is what the resolver answers from the law
        // date, and what the rows' own `household` column therefore holds.
        if (/FROM households/.test(sql)) return { rows:
          [...new Set(Object.values(identities))].map((key, ord) => ({
            slug: String(key).replace(/^hh:/, ""), ord, name: null, human: null, accounts: [],
            residents: Object.keys(identities).filter((h) => identities[h] === key),
            since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
          })) };
        if (/FROM household_pins/.test(sql)) return { rows: [] };
        if (/FROM registry_meta/.test(sql)) return { rows: [{ key: "schema_version", value: 1 }] };
        // THE AMEND'S SUPERSESSION LOOKUP, which is a different question with
        // different arguments: "is there a PENDING claim for this slug in this
        // window to chain from". Told apart by `window_id`, because answering
        // it with the guard's branch read `statuses.includes` off a window id.
        // Empty is the truthful answer here -- nothing in these fixtures is
        // pending -- so an amend files a fresh claim, which is what
        // `claimTxFromJournal` does when it finds no in-window chain.
        // ⚑ THE READ BRANCHES MUST REQUIRE `SELECT`. "DELETE FROM claims"
        // contains "FROM claims", so a bare match here swallowed the
        // withdrawal's deletion and answered it with a row list -- the drafts
        // stayed on the docket and nothing said so.
        if (/^SELECT/i.test(sql.trim()) && /FROM claims/.test(sql) && /window_id/.test(sql)) return { rows: [] };
        // "Is there a STANDING mark with this slug to amend?" -- the fall-back
        // the supersession chain asks when no in-window pending claim exists
        // (#2806). No fixture here has ever been published, so the truthful
        // answer is none, and the amend files a fresh claim.
        if (/FROM marks/.test(sql)) return { rows: [] };
        if (/^SELECT/i.test(sql.trim()) && /FROM claims/.test(sql)) {
          calls.claims += 1;
          // `asked` is the SPELLING SET now (`household = ANY($2)`), so the
          // filter is membership rather than equality — the predicate the
          // policy evaluates, in the shape it evaluates it. `scopeAs` still
          // rewrites what the guard asked for, which is what the CAN-FAIL test
          // below flips to make the duplicate slip through.
          const [statuses, asked] = args;
          const keys = asked == null ? null : [].concat(asked).map(scopeAs);
          return { rows: claims.filter((c) => statuses.includes(c.status) && (keys == null || keys.includes(c.household))) };
        }
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
        // the withdrawal's mark lock (WLD-27 A): one client, nothing to wait on
        if (/^SELECT pg_advisory_(xact_)?(un)?lock(_shared)?\(hashtext\((\$1|'[^']*')\)\)$/.test(sql.trim())) return { rows: [{}] };
        // the withdrawal's replay question (WLD-27 D, R2): has a withdrawal of this mark returned a set-down unit? Never, here
        if (/FROM acts\s+WHERE object = \$1 AND class = 'holding' AND action = \$2 AND actor = \$3/.test(sql)) return { rows: [] };

        // THE WRITE. `insertAct`'s column list, in its order; the id is
        // assigned here because that is what the sequence does.
        if (/^INSERT INTO acts/i.test(sql.trim())) {
          const id = nextActId++;
          acts.push({ id, at: args[0], crossing: args[1], actor: args[2], action: args[3],
            object: args[4],
            // THE WITNESSED LINE IS THREE COLUMNS, on this side of the seam as
            // on the other -- it has never lived in `payload`, and a fixture
            // that put it there would agree with a reader nothing writes for.
            at_anchor: args[5], at_dx: args[6], at_dy: args[7],
            witnesses: args[8], class: args[9], payload: args[10],
            effect: args[11], household: args[12],
            // ⚑ ONLY PRESENT IF THE PEN SENT IT. G1 drops `acts.journal_seq`
            // (migration 025) and the pen stopped naming it; a row that carried
            // the key unconditionally would let a suite assert the column's
            // absence and pass while the pen still wrote it.
            ...(args.length > 13 ? { journal_seq: args[13] } : {}) });
          return { rows: [{ id }], rowCount: 1 };
        }
        // The docket half a mark-class row reaches on the same client.
        // The candle's lock (POS-404), shared before the window read; no clearing runs here.
        if (/^SELECT pg_advisory_xact_lock_shared\(/i.test(sql.trim())) return { rows: [{}] };
        if (/FROM windows/i.test(sql)) return { rows: [{ id: 1 }] };
        // THE DOCKET RECEIVES THE ROW, it does not swallow it. A stub that
        // acknowledged the INSERT and kept nothing would let "the door filed a
        // duplicate slug" pass, because the guard's next read would find the
        // docket empty -- the permissive direction, which is the one direction a
        // guard may not fail in. The column list is `claimTxFromJournal`'s.
        if (/^INSERT INTO claims/i.test(sql.trim())) {
          const [, kind, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status] = args;
          claims.push({ id: `00000000-0000-0000-0000-0000000000${String(claims.length + 1).padStart(2, "0")}`,
            slug, class: kind, claimant, household, status, body,
            geometry: typeof geometry === "string" ? JSON.parse(geometry) : geometry,
            bbox, stake, supersedes, data, submitted_at: new Date() });
          return { rows: [{ id: claims.at(-1).id }], rowCount: 1 };
        }
        // Withdraw's two outcomes: a draft is DELETED, a pending claim retracted.
        // THE HOUSEHOLD IS A SPELLING SET NOW (POS-160 / #165). The withdraw's
        // DELETE went from `household = $3` to `household = ANY($3)`, and $3 is
        // `declaredKeys`' array -- a house may be spelled more than one way and
        // a draft filed under any of its spellings is still its draft. A stub
        // still comparing against a scalar matched none of them, so the drafts
        // stayed on the docket and the slug stayed taken.
        if (/^DELETE FROM claims/i.test(sql.trim())) {
          const [slug, claimant, households] = args;
          const keys = Array.isArray(households) ? households : [households];
          const before = claims.length;
          for (let i = claims.length - 1; i >= 0; i--) {
            const c = claims[i];
            if (c.status === "draft" && c.slug === slug && c.claimant === claimant && keys.includes(c.household)) claims.splice(i, 1);
          }
          return { rows: [], rowCount: before - claims.length };
        }
        // `declaredKeys` asks the session for the house's spellings; a client
        // that has none falls back to the one key it was given, which is this
        // fixture's case and the honest answer for a store with no session.
        if (/current_setting\('app\.household_keys'/i.test(sql)) return { rows: [{ keys: null }] };
        if (/^UPDATE claims/i.test(sql.trim())) return { rows: [], rowCount: 0 };
        // WLD-138 B: the withdraw door asks whether the mark is a full set-down holder (its newest hold row,
        // set-down-return.mjs § setDownHolderOf). This fixture keeps no hold lane, so there is none.
        if (/FROM acts\s+WHERE class = \$1 AND object = ANY\(\$2\) AND action = ANY\(\$3\)/i.test(sql)) return { rows: [] };

        throw new Error(`the hand-built store was asked something it does not know: ${sql.slice(0, 80)}`);
      },
      release() { /* pooled in name only */ },
    },
  };
  // The pools take a POOL, so the store is one: `connect()` hands back the same
  // client every read in this file already uses.
  self.connect = async () => self.client;
  self.query = (sql, args) => self.client.query(sql, args);
  self.end = async () => {};
  return self;
};

/** One live draft of alpha's, filed under the RESOLVED KEY, as the docket pen files it. */
const draftClaim = (slug, over = {}) => ({
  id: "00000000-0000-0000-0000-000000000001",
  // POS-160: the resolved key is the house's SLUG now, so the row wears what
  // `householdKeyFor` files it under. If these two ever drift apart again the
  // guard reads an empty `claims` and permits the duplicate, which is exactly
  // what the CAN-FAIL test below makes happen on purpose.
  slug: `alpha/${slug}`, class: "sited", claimant: "alpha", household: "hh:alpha-house", status: "draft",
  body: "the docket already holds this one",
  geometry: { slug: `alpha/${slug}`, at: { x: 110, y: 105 }, extent: { w: 2, h: 2 } },
  stake: 0, data: { by: "alpha", kind: "sited", date: "2026-09-03", _journal_seq: 1 },
  submitted_at: new Date("2026-09-03T00:00:00Z"),
  ...over,
});

const withGuardsFlipped = async (store, fn) => {
  const guards = await import("../src/world2-guards.mjs");
  const acts = await import("../src/world2-acts.mjs");
  const pen = await import("../src/world2-pen.mjs");
  const house = await import("../src/household-deriver.mjs");
  const claims = await import("../src/world2-claims.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL, flag: process.env.W2_GUARDS };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://hand-built/none";   // never dialled — the reader is replaced
  process.env.W2_GUARDS = "1";
  const restore = guards.useGuardReader((run) => run(store.client));
  // THE WRITE GOES TO THE SAME STORE (G1). Both pools, because the office holds
  // two: `world2-acts.mjs` has the mirror's and `world2-pen.mjs` the awaited
  // pen's, and a test that set only one would write through the other and reach
  // a real socket.
  acts.__setPoolForTest(store);
  pen.__setPoolForTest(store);
  // And the docket pen's own pool: `claimHouseholdFor` resolves the house on it
  // (POS-457). Unset, it reached a real socket whenever its memo was cold.
  claims.__setPoolForTest(store);
  house.__clearHouseCache();
  try {
    assert.equal(guards.guardsFlipped(), true, "the flag is READ, not merely set — B1's gate 1");
    return await fn(guards);
  } finally {
    restore();
    acts.__setPoolForTest(null);
    pen.__setPoolForTest(null);
    claims.__setPoolForTest(null);
    house.__clearHouseCache();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url], ["W2_GUARDS", prev.flag]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};
