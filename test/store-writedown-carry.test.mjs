// store-writedown-carry.test.mjs — THE PRINTOUT FOLLOWS THE CARRY (POS-441).
//
// Moving a mark carries the marks inside it that belong to the same household
// (ruled by Darko 2026-10-07). The store writes every rider at its new WORLD
// position in the mover's window (world2/tools/carry.mjs); this file is the
// write-down's half — the git printout of those rows must say the same places.
//
// Two seams the design note named (Starstory docs/2026-10-07/rail/POS-441/DESIGN.md § 2):
//
//   1. THE FRAMER read every frame's centre from the LAST published fold. A
//      rider nested under the mover, framed against the mover's OLD centre,
//      landed at the move's offset twice.
//   2. THE CROSSING'S DECLARED-PARENT CHECK read the parent where the last fold
//      left it too, so a rider filed in its parent but standing outside it (the
//      live tree has three, same-household) refused the whole crossing for a
//      displacement it did not introduce or move.
//
// And the invariant both serve, held by the world's own fold: after the
// write-down, the printed tree places every mark exactly where the store does.
//
// The fixture: Rei's parcel filed at the fossil root; her house filed inside it
// (file numbers 0,0); her lamp filed inside the house at 50,50 — outside the
// house's 10×10 and outside the parcel too. The carry moved all three by
// (+100, −40).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fileFramer } from "../src/world-drain.mjs";
import { planStoreWriteDown, normalizeMark, storeWriteDown } from "../src/store-writedown.mjs";
import { declaredParentRefusal, carriedTogether } from "../src/mark-declared-parent.mjs";
import { renderedMark } from "../world2/tools/mark-render.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
function findWorldCheckout() {
  for (const c of [process.env.POSTMARK_WORLD_CLONE, process.env.WORLD_CLONE, join(OFFICE, "world-clone"), join(OFFICE, "..", "postmark-world")].filter(Boolean))
    if (existsSync(join(c, "tools", "marks-fold.mjs"))) return c;
  return null;
}
const WORLD = findWorldCheckout();
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE) — these need the real fold";

const ROOT = "WORLD/marks/let-there-be-light";
const PARCEL_DIR = `${ROOT}/the-parcel`, HOUSE_DIR = `${PARCEL_DIR}/the-house`, LAMP_DIR = `${HOUSE_DIR}/the-lamp`;
const MOVE = { dx: 100, dy: -40 };
const BEFORE = { parcel: { x: 1000, y: 1000 }, house: { x: 1000, y: 1000 }, lamp: { x: 1050, y: 1050 } };
const after = (p) => ({ x: p.x + MOVE.dx, y: p.y + MOVE.dy });

const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;

function carriedWorld(t) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-storewd-carry-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });
  const put = (p, text) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/households.json", `${JSON.stringify({ households: { rei: "hh:starforge" } }, null, 2)}\n`);
  put(`${ROOT}/mark.md`, rec(["kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative"], "Let there be light."));
  put(`${PARCEL_DIR}/mark.md`, rec(["kind: parcel", "by: rei", "date: 2026-08-01", "at: { x: 1000, y: 1000 }", "extent: { w: 25, h: 25 }"], "Rei's parcel."));
  put(`${HOUSE_DIR}/mark.md`, rec(["kind: sited", "by: rei", "date: 2026-08-01", "at: { x: 0, y: 0 }", "extent: { w: 10, h: 10 }"], "Rei's house."));
  put(`${LAMP_DIR}/mark.md`, rec(["kind: sited", "by: rei", "date: 2026-08-01", "at: { x: 50, y: 50 }", "extent: { w: 1, h: 1 }"], "A lamp out back."));
  put("WORLD/filing-freeze.json", `${JSON.stringify({ frozen_at: "2026-08-25", marks: {
    "rei/the-parcel": PARCEL_DIR, "rei/the-house": HOUSE_DIR, "rei/the-lamp": LAMP_DIR,
  } }, null, 2)}\n`);
  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon");
  return { repo, git };
}

function foldAt({ repo, git }, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-storewd-carry-fold-"));
  try {
    cpSync(join(WORLD, "tools"), join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));
    for (const p of git("ls-tree", "-r", "--name-only", ref, "--", "WORLD").trim().split("\n").filter(Boolean)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), git("show", `${ref}:${p}`));
    }
    execFileSync(process.execPath, [join(dir, "tools", "marks-fold.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const state = JSON.parse(readFileSync(join(dir, "WORLD", "world-state.json"), "utf8"));
    return new Map(state.marks.filter((m) => m.at).map((m) => [m.id, m.at]));
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

// THE STORE'S ROWS after the carry: world positions, and no `_fileAt` — the
// clearing drops a seeded row's file bookkeeping when it writes the rider.
const storeRow = (slug, kind, at, ext, carriedBy = null) => ({
  slug, kind, owner: "rei", household: "hh:starforge", locked_window: 240, status: "standing",
  geometry: { at, extent: ext }, body: `${slug}.`,
  data: { by: "rei", date: "2026-10-07", kind, tier: "home", ...(carriedBy ? { _carried_by: carriedBy } : {}) },
});
const ROWS = [
  storeRow("rei/the-parcel", "parcel", after(BEFORE.parcel), { w: 25, h: 25 }),
  storeRow("rei/the-house", "sited", after(BEFORE.house), { w: 10, h: 10 }, "claim-move"),
  storeRow("rei/the-lamp", "sited", after(BEFORE.lamp), { w: 1, h: 1 }, "claim-move"),
];
const entryFor = (row) => ({ slug: row.slug, kind: row.kind, by: row.owner, household: row.household, locked_window: row.locked_window,
  status: row.status, founder_commit: null, ...renderedMark(row) });
const FILED = { "rei/the-parcel": `${PARCEL_DIR}/mark.md`, "rei/the-house": `${HOUSE_DIR}/mark.md`, "rei/the-lamp": `${LAMP_DIR}/mark.md` };
const planOf = (toFileFrame) => planStoreWriteDown(ROWS.map((r) => normalizeMark(entryFor(r))),
  { publishedPathOf: (id) => FILED[id] ?? null, canonBytesAt: () => null, toFileFrame });
const upsertOf = (plan, id) => plan.households.flatMap((h) => h.upserts).find((u) => u.id === id);

test("SEAM 1: a rider nested under the mover is framed against where the mover stands NOW — its file numbers do not change", { skip: WHY_SKIP }, async (t) => {
  const { repo } = carriedWorld(t);
  const plan = planOf(await fileFramer(repo));
  assert.deepEqual(upsertOf(plan, "rei/the-house").fileRec.at, { x: 0, y: 0 }, "the house still sits at its parcel's centre");
  assert.deepEqual(upsertOf(plan, "rei/the-lamp").fileRec.at, { x: 50, y: 50 }, "the lamp keeps its offset from the house");
  assert.deepEqual(upsertOf(plan, "rei/the-parcel").fileRec.at, after(BEFORE.parcel), "the root-filed mover's file says its world number");
});

test("SEAM 1, THE FLIP: a framer with no batch frames the rider against the OLD centre — the move's offset lands twice", { skip: WHY_SKIP }, async (t) => {
  const { repo } = carriedWorld(t);
  const framer = await fileFramer(repo);
  delete framer.batch;        // the framer as it was before POS-441
  assert.deepEqual(framer({ at: after(BEFORE.house), path: `${HOUSE_DIR}/mark.md` }).at, { x: MOVE.dx, y: MOVE.dy },
    "(100, −40) relative to a parcel that itself moved by (100, −40): the house would stand 200 east and 80 south of where it was");
  assert.throws(() => planOf(framer), (e) => e.reason === "mark-outside-declared-parent" && /rei\/the-house/.test(e.detail),
    "and the old crossing never got that far: reading the parcel where the last fold left it, it refused the carried house and stopped the town's crossing");
});

test("SEAM 2: the lamp, filed in the house and standing outside it, is carried with it — the crossing's declared-parent check admits it; the door's (no prior for the parent) still refuses a mark moved out on its own", { skip: WHY_SKIP }, async (t) => {
  const { repo } = carriedWorld(t);
  const framer = await fileFramer(repo);
  assert.doesNotThrow(() => planOf(framer), "carried together: no displacement introduced or moved, so the crossing does not refuse");

  const lampPrior = { at: BEFORE.lamp, extent: { w: 1, h: 1 } }, lampNow = { at: after(BEFORE.lamp), extent: { w: 1, h: 1 } };
  const housePrior = { at: BEFORE.house, extent: { w: 10, h: 10 } }, houseNow = { at: after(BEFORE.house), extent: { w: 10, h: 10 } };
  const inside = (pt, m) => Math.abs(pt.x - m.at.x) <= m.extent.w / 2 && Math.abs(pt.y - m.at.y) <= m.extent.h / 2;
  const ask = (parentPrior) => declaredParentRefusal({ id: "rei/the-lamp", prior: lampPrior, next: lampNow,
    parentId: "rei/the-house", parent: houseNow, parentPrior, pointWithinMark: inside });
  assert.equal(ask(housePrior), null, "the parent moved by the same offset: carried together");
  assert.ok(ask(null), "THE FLIP: without the parent's prior — the door's question — the same numbers refuse, as the 09-20 ruling says they must for an owner's own move");
  assert.equal(carriedTogether(lampPrior, { at: { x: 1150, y: 1011 } }, housePrior, houseNow), false, "a different offset is the owner's own move, not a carry");
});

test("THE INVARIANT: after the write-down, the world's own fold places every mark exactly where the store does", { skip: WHY_SKIP }, async (t) => {
  const w = carriedWorld(t);
  const before = foldAt(w, "main");
  assert.deepEqual(before.get("rei/the-lamp"), BEFORE.lamp, "the control: canon before the carry");
  const report = storeWriteDown({
    repo: w.repo, at: Date.parse("2026-10-07T18:00:00.000Z"), toFileFrame: await fileFramer(w.repo),
    input: { marks: ROWS.map(entryFor), stakes: [],
      as_of: { window: 240, world_sha: "0".repeat(40), town_sha: "1".repeat(40) },
      selection: { by: "docket", window: 240, docket_claims: 1, carried_absent: { checked: true, count: 0 } } },
  });
  assert.equal(report.households.length, 1);
  const printed = foldAt(w, report.households[0].branch);
  for (const r of ROWS) assert.deepEqual(printed.get(r.slug), r.geometry.at, `${r.slug}: the printout says what the store says`);
});
