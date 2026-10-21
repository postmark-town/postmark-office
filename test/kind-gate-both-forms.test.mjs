// kind-gate-both-forms.test.mjs — the leave-mark door takes a W2 instance kind,
// and writes the form the class tree it stands under says (LOGOS v2 part 2, O2).
//
// THE LAW: LOGOS/classes.md § The LOGOS ladder (ruled 2026-10-16 16:02): "`kind`
// is a flat field naming the node's own class … The `class:` field folds into
// `kind`." W2 (postmark-world#236, b12b7156) migrates the record: 131 resident
// things to `kind: thing`, wright/the-candle-vault to `kind: portal-ground`.
// Instances of a post class (idea, bounty, funding-quest) keep the old form
// (WLD-73 G7, settled 2026-10-17). O1's body, G3: "The office's own writers
// stay on the old form here and flip in O2."
//
// THE DEFECT (lane o2-ride-check, driven against a re-folded W2 world, at
// office 674430cce): the door accepted only sited, parcel, predicated and
// naming, so after W2 every write that sends a thing as it stands was a 422
// `got "thing"`: the hold door's set-down amend (POS-138's bug back for every
// migrated thing), the stance welcome (the same fileAuthorsAmend), an amend, a
// move, a new `kind: thing`. And an amend in the old spelling on a W2 mark was
// accepted and filed the OLD form, silently undoing the migration.
//
// WHAT THIS HOLDS, as a matrix: two class trees × the stool in both forms ×
// both input spellings, through the real doors (callHoldTool, fileSetDownAmend,
// leaveMarkViaOffice, withdrawMarkViaOffice) onto the in-memory record, read
// back off the claim the door wrote (its `kind` column and its `data`).
//
//   the pinned tree   world-clone daef8487 (test/clone-pins.json): thing,
//                     bounty, parcel and portal-ground extend `mark`; there is
//                     no `sited` class. The record is the old form, so the door
//                     writes the old form: kind: sited + class: thing.
//   the W2 tree       postmark-world b12b7156: thing, parcel and portal-ground
//                     under `sited`; bounty under `post`. The door writes
//                     kind: thing, with no class: line, whatever spelling it
//                     was sent; a bounty stays kind: sited + class: bounty.
//
// The form written is the class tree's answer, asked through O1's resolver
// (world-grants § isSited over the class layer's extends): a class whose
// lineage stands it as sited is written as its own kind. Never a hand list.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/kind-gate-both-forms.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "kind-gate-world-"));
const town = mkdtempSync(join(tmpdir(), "kind-gate-town-"));
after(() => { sweep(repo); sweep(town); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle (owners-word-at-the-door.test.mjs's, with two stools) ──
//
// Keith's house holds the garage and a yard parcel. Two of his stools stand in
// the garage: one in the old form (as every store folded before W2 holds it),
// one in the new (as W2's migration writes it). Same fields otherwise, copied
// from the live record (world main 5509c996).
const GARAGE_AT = { x: 3978, y: -398 };
const YARD_AT = { x: 4100, y: -300 };
const stoolFields = {
  by: "keith", tier: "home", household: "keith", declared_household: "gh:1",
  date: "2026-09-10T15:37:58.221Z", at: GARAGE_AT, extent: { w: 1, h: 1 }, sovereign: true, stamps: 2, weight: 2,
  weight_parts: { own_escrow: 2 }, body: "Three-legged stool in pale ash: splayed legs, brass levelers, a seat sanded kind.",
  placementParent: "keith/the-garage", ledger_weight: 2,
};
const OLD = { id: "keith/stool-old-form", ...stoolFields, kind: "sited", class: "thing" };
const NEW = { id: "keith/stool-new-form", ...stoolFields, kind: "thing" };
const STOOLS = { old: OLD, new: NEW };
// A thing its maker made a holder (O2, review-610 S8: holder and open are the maker's word on the record).
const CRATE = { id: "keith/a-holder-crate", ...stoolFields, body: "A slatted crate with a rope handle.", kind: "thing", holder: true, open: true };
// A RESIDENT'S HOLDER AS THE FOLD PUBLISHES IT (postmark-world#238: marks-fold carries the record's own
// spelling, and the world's parser has no boolean case, so holder and open arrive as "true"/"false").
const POUCH = { id: "keith/a-small-pouch", ...stoolFields, body: "A small leather pouch.", kind: "thing", holder: "true", capacity: 10, open: "false" };
const STANDING = { [OLD.id]: "7f3a0c1e-0000-4000-8000-000000000701", [NEW.id]: "7f3a0c1e-0000-4000-8000-000000000702", [CRATE.id]: "7f3a0c1e-0000-4000-8000-000000000703", [POUCH.id]: "7f3a0c1e-0000-4000-8000-000000000704" };

const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "keith/the-garage", by: "keith", kind: "sited", tier: "home", at: GARAGE_AT, extent: { w: 20, h: 20 }, body: "one bay door up" },
  { id: "keith/the-yard", by: "keith", kind: "parcel", tier: "home", at: YARD_AT, extent: { w: 25, h: 25 }, body: "the yard behind the garage" },
  OLD, NEW, CRATE, POUCH,
];

put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
export function pointWithinMark(p, m) {
  return Boolean(m?.at && m?.extent) && Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
}
`);
put(repo, "tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
`);
put(repo, "tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { keith: "gh:1", kin: "gh:1" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "kind-gate falsifier");
git("add", "-A");
git("commit", "-qm", "canon: keith's two stools, folded in his garage");
git("branch", "-q", "draft/keithhouse");

const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const REGISTRY_ROWS = rowsFromRegistry({ households: {
  "keith-house": { residents: ["keith", "kin"], accounts: [{ login: "keith-gh", id: 1 }] },
} }, {});

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.W2_GUARDS = "1";
process.env.W2_PEN = "mark,hold";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, readHoldsFrom, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const claimsPen = await import("../src/world2-claims.mjs");
let unread = () => {};
const install = async () => {
  const p = installActsPen({ marks: Object.entries(STANDING).map(([slug, id]) => ({ id, slug })), households: REGISTRY_ROWS.households });
  claimsPen.__setPoolForTest(p);
  unread(); unread = await readHoldsFrom(p);
  return p;
};
let pen = await install();
after(() => { unread(); uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const hold = await import("../src/world-hold.mjs");
const world = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
after(() => resetLawSnapshot());

// ── the two class trees, as the office's class layer (a law snapshot) ────────
const SHA = "e".repeat(40);
const row = (key, ext, makers) => ({ number: 260, tag_sha: SHA, newest: 260, kind: "class", key,
  data: { class: key, ...(ext ? { extends: ext } : {}), ...(makers === undefined ? {} : { dials: { makers } }) } });
// The thing's holder properties as W2 states them (sovereign, so the maker's own word counts).
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 260, tag_sha: SHA, newest: 260, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const TREES = {
  // world-clone daef8487, the office CI pin: every instance class extends mark; no sited class.
  pinned: [row("postmark-node", null, false), row("mark", "postmark-node"), row("thing", "mark", true),
    row("parcel", "mark"), row("bounty", "mark", true), row("portal-ground", "mark", false)],
  // postmark-world b12b7156 (W2): thing, parcel, portal-ground under sited; bounty under post (a post class).
  w2: [row("postmark-node", null, false), row("mark", "postmark-node"), row("sited", "mark", true),
    row("thing", "sited", true), row("parcel", "sited"), row("portal-ground", "sited", false),
    row("post", "postmark-node"), row("bounty", "post", true), row("predicate", "mark"), row("naming", "predicate"),
    prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
    prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
    prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign")],
};
const underTree = (name) => reloadLawSnapshot({ force: true,
  query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 260, pinned: 260 }] : TREES[name] }) });

// What each tree's writers file for a thing: the form the record under it holds.
const THING_WRITTEN = { pinned: { kind: "sited", class: "thing" }, w2: { kind: "thing" } };
const SPELLINGS = { old: { kind: "sited", class: "thing" }, new: { kind: "thing" } };

const KEITH = { household: "keithhouse", handles: new Set(["keith", "kin"]) };
const HOUSES = (h) => ({ keith: { key: "gh:1", slug: "keith-house" }, kin: { key: "gh:1", slug: "keith-house" } })[h] ?? null;
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const fresh = async () => { uninstallActsPen(); pen = await install(); return pen; };
const hand = (thing, who) => pen.seedAct({ class: "holding", actor: who, action: "take", object: thing, at: new Date(),
  payload: { thing, holder: who, previous_holder: null, made_by: "keith", policy: "cascade" } });
const outcome = async (fn) => { try { return { ok: await fn() }; } catch (e) { return { refused: { code: e?.code ?? null, defect: e?.defect ?? String(e?.message ?? e), hint: e?.hint ?? null } }; } };
const slugOf = (id) => id.split("/")[1];
const asItStands = (m) => ({ kind: m.kind, ...(m.class !== undefined ? { class: m.class } : {}) });

/** The form the door wrote: the last claim's `kind` column, and the `class` its data carries (absent when none). */
function written(p) {
  const c = p.claims().at(-1);
  assert.ok(c, "the door wrote no claim");
  const data = parse(c.data) ?? {};
  return { kind: c.class, ...(data.class !== undefined ? { class: data.class } : {}), dataKind: data.kind ?? null };
}
const assertForm = (got, want, what) => {
  assert.deepEqual({ kind: got.kind, ...(got.class !== undefined ? { class: got.class } : {}) }, want, `${what}: the claim's kind column and class`);
  assert.equal(got.dataKind, want.kind, `${what}: the claim's data carries the same kind`);
};

for (const tree of ["pinned", "w2"]) {
  const want = THING_WRITTEN[tree];
  for (const [form, stool] of Object.entries(STOOLS)) {
    // POS-688 (E8): the settlement prints a set-down where it was made, so the door files no amend:
    // the printout is the one writer of a held thing's place, whichever form the thing is written in
    test(`[${tree} tree · ${form}-form stool] the author's set-down (hold door drop) files no amend: the settlement prints it`, async () => {
      await underTree(tree);
      const p = await fresh(); hand(stool.id, "keith");
      const r = await hold.callHoldTool("world_hold", { thing: stool.id, handle: "keith" }, KEITH);
      assert.equal(r.did, "drop", `the door answered ${JSON.stringify(r).slice(0, 400)}`);
      assert.equal(p.rows().some((a) => a.action === "amend"), false, "no amend act on the record");
      assert.equal(r.set_down?.amend, undefined);
      assert.match(r.stands_note, /the settlement prints it here at the next crossing/);
    });

    test(`[${tree} tree · ${form}-form stool] fileSetDownAmend (the call the stance welcome makes too) files in the ${tree} form`, async () => {
      await underTree(tree);
      const p = await fresh();
      const out = await hold.fileSetDownAmend({ did: { thing: stool.id, declared_by: "keith", at: new Date().toISOString(), did: "drop" },
        stood: YARD_AT, key: KEITH, actId: 1636, deps: { householdOf: HOUSES, mark: stool } });
      assert.equal(out.amend.filed, true, `refused: ${out.amend.why}`);
      assertForm(written(p), want, "the author's amend");
    });

    for (const [spelling, sent] of Object.entries({ "as it stands": asItStands(stool), [`in the ${form === "old" ? "new" : "old"} spelling`]: SPELLINGS[form === "old" ? "new" : "old"] })) {
      test(`[${tree} tree · ${form}-form stool] amend the body, ${spelling}, files in the ${tree} form`, async () => {
        await underTree(tree);
        const p = await fresh();
        const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: slugOf(stool.id), amend: true,
          ...sent, at: stool.at, extent: stool.extent, body: "Three-legged stool in pale ash, re-oiled." }, KEITH));
        assert.ok(r.ok?.amended, `refused: ${JSON.stringify(r.refused)}`);
        assertForm(written(p), want, "the amend");
      });

      test(`[${tree} tree · ${form}-form stool] move it (amend at), ${spelling}, files in the ${tree} form`, async () => {
        await underTree(tree);
        const p = await fresh();
        const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: slugOf(stool.id), amend: true,
          ...sent, at: YARD_AT, extent: stool.extent, body: stool.body }, KEITH));
        assert.ok(r.ok?.amended, `refused: ${JSON.stringify(r.refused)}`);
        assert.equal(r.ok.put_forward, true, "on Keith's own parcel it goes forward at ✦0");
        assertForm(written(p), want, "the move");
      });
    }

    // Under the pinned tree a `kind: thing` RECORD stands as nothing sited (thing
    // extends mark, and O1's world-grants § standingOf finds no sited in its
    // lineage), so it holds no description there. No such record exists under
    // that tree: W1 and W2 ship together, and W2 writes the new form.
    const impossible = tree === "pinned" && form === "new"
      ? "a new-form record under the pre-W1 tree: O1's standingOf stands it as no sited mark" : false;
    test(`[${tree} tree · ${form}-form stool] a description laid on it, in either predicate spelling`, { skip: impossible }, async () => {
      await underTree(tree);
      for (const kind of ["predicate", "predicated"]) {
        const p = await fresh();
        const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: `stool-colour-${form}`, kind,
          parent_id: stool.id, slot: "colour", value: "pale ash", body: "The stool is pale ash." }, KEITH));
        assert.ok(r.ok?.id, `kind: ${kind} refused: ${JSON.stringify(r.refused)}`);
        assert.equal(parse(p.claims().at(-1).data).parent_id, stool.id, "it describes the stool");
      }
    });

    test(`[${tree} tree · ${form}-form stool] withdraw it`, async () => {
      await underTree(tree);
      const p = await fresh();
      const r = await outcome(() => world.withdrawMarkViaOffice(repo, { mark: stool.id }, KEITH, { escrowOf: () => 0 }));
      assert.ok(r.ok, `refused: ${JSON.stringify(r.refused)}`);
      assert.ok(p.rows().some((a) => a.action === "withdraw"));
    });
  }

  for (const [spelling, sent] of Object.entries(SPELLINGS)) {
    test(`[${tree} tree] a brand-new thing, ${spelling} spelling, files in the ${tree} form`, async () => {
      await underTree(tree);
      const p = await fresh();
      const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: `a-crate-${spelling}`, ...sent,
        at: YARD_AT, extent: { w: 1, h: 1 }, body: "A pine crate, nailed shut." }, KEITH));
      assert.ok(r.ok?.id, `refused: ${JSON.stringify(r.refused)}`);
      assertForm(written(p), want, "the new thing");
    });
  }

  // A POST CLASS KEEPS THE OLD FORM (WLD-73 G7): W2 leaves idea, bounty and
  // funding-quest instances as they are, and so does the door, in either spelling.
  for (const [spelling, sent] of Object.entries({ old: { kind: "sited", class: "bounty" }, new: { kind: "bounty" } })) {
    test(`[${tree} tree] a bounty notice, ${spelling} spelling, is written kind: sited + class: bounty`, async () => {
      await underTree(tree);
      const p = await fresh();
      const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: `mend-the-gate-${spelling}`, ...sent,
        ask: "mend the yard gate", reward: 1, at: YARD_AT, extent: { w: 1, h: 1 }, body: "The yard gate hangs off one hinge." }, KEITH));
      assert.ok(r.ok?.id, `refused: ${JSON.stringify(r.refused)}`);
      assertForm(written(p), { kind: "sited", class: "bounty" }, "the bounty");
    });
  }

  test(`[${tree} tree] a kind and a class that disagree are refused, naming both`, async () => {
    await underTree(tree);
    await fresh();
    const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: "a-muddle", kind: "thing", class: "bounty",
      at: YARD_AT, extent: { w: 1, h: 1 }, body: "A muddle." }, KEITH));
    assert.equal(r.refused?.code, 422, JSON.stringify(r));
    assert.match(r.refused.defect, /kind "thing" names the class.*class "bounty"/);
  });

  test(`[${tree} tree] a kind that names no class the law knows is refused, and the refusal says what kind may be`, async () => {
    await underTree(tree);
    await fresh();
    const r = await outcome(() => world.leaveMarkViaOffice(repo, { by: "keith", slug: "a-gizmo", kind: "gizmo",
      at: YARD_AT, extent: { w: 1, h: 1 }, body: "A gizmo." }, KEITH));
    assert.equal(r.refused?.code, 422, JSON.stringify(r));
    assert.match(r.refused.defect, /kind must be sited, parcel, predicate \(or predicated\), naming, or a class the law knows/);
    assert.match(r.refused.hint, /got "gizmo"/);
    assert.match(r.refused.hint, /thing/, "the hint names the classes the law knows");
  });
}

// A HOLDER IS SET DOWN LIKE ANY THING, and since POS-688 (E8) no amend is filed at the door for either:
// the printout copies the standing row's own data (hold-through.mjs), so holder, capacity and open ride it whole.
test("[w2 tree] a holder thing set down by its author files no amend at the door, whichever words it carries", async () => {
  await underTree("w2");
  for (const thing of [CRATE, POUCH]) {
    const p = await fresh(); hand(thing.id, "keith");
    const r = await hold.callHoldTool("world_hold", { thing: thing.id, handle: "keith" }, KEITH);
    assert.equal(r.did, "drop", JSON.stringify(r).slice(0, 400));
    assert.equal(p.rows().some((a) => a.action === "amend"), false, `${thing.id}: no amend act`);
  }
});

test("the hold door's guidance names the new spelling (amendCallFor)", () => {
  const call = hold.amendCallFor("keith/stool-new-form", YARD_AT);
  assert.match(call.note, /kind: thing/, "a resident sending the mark as it stands is told kind names its class");
});
