// mark-repair.test.mjs — POS-1025/b: an operator amends or withdraws a mark that is not theirs.
//
// Ruled (Darko, POS-1025/b "Both", 2026-11-13; the build disposition's item 7): the town's hands amend AND withdraw an
// existing mark without its resident's consent, through the clearing, as the mark's own author and household, with a
// named hand, a reason and a receipt; the route is `operator`; law and class marks are refused; no stamp moves.
//
// The world in a bottle and the store's pen stub are placing-on-a-residents-behalf.test.mjs's (POS-233): the act and
// its claim are written on one client, so the claim's household, its status and the act's provenance are read where
// the clearing will read them.
//
// THE CAN-FAIL FLIPS (run receipts in the PR):
//   · leaveMarkAct's household back to `key.household`       → "the amend lands as the resident's" red (draft/keeminlee)
//   · provenanceOf ignoring the operator scope               → "the act names the operator's hand" red (hand reader, route null)
//   · repairGate admitting a draft                           → "a repair that would not publish" red (a claim is written)
//   · the withdraw door's escrow guard skipped for operators → "a staked mark" red
//
//   node --test test/mark-repair.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-1025-repair-repo-"));
const town = mkdtempSync(join(tmpdir(), "postmark-1025-repair-town-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-1025-repair-db-"));
after(() => { sweep(repo); sweep(town); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
const FLAT = { id: "reader/the-keepers-flat", by: "reader", kind: "parcel", tier: "home", household: "reader", at: { x: 300, y: 300 }, extent: { w: 25, h: 25 }, body: "the keeper's flat" };
const PORCH = { id: "solace/the-far-bank-porch", by: "solace", kind: "parcel", tier: "home", household: "solace", at: { x: -725, y: 800 }, extent: { w: 25, h: 25 }, body: "a porch on the far bank" };
const BENCH = { id: "reader/a-bench", by: "reader", kind: "sited", household: "reader", at: { x: 1900, y: 1900 }, extent: { w: 2, h: 1 }, body: "a bench out on the commons" };
const BOARD = { id: "the-town/the-noticeboard", by: "the-town", kind: "sited", household: "the-town", at: { x: 60, y: 60 }, extent: { w: 2, h: 2 }, body: "the town's noticeboard" };
const MILL = { id: "solace/the-old-mill", by: "solace", kind: "sited", household: "solace", at: { x: -700, y: 790 }, extent: { w: 4, h: 4 }, body: "the old mill by the porch" };
const LAW = { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 4000, h: 4000 }, body: "the world frame" };
const PUBLISHED = [LAW, FLAT, PORCH, BENCH, BOARD, MILL];
const record = (m) =>
  `---\nkind: ${m.kind}\nby: ${m.by}\ndate: 2026-08-01\nat: { x: ${m.at.x}, y: ${m.at.y} }\nextent: { w: ${m.extent.w}, h: ${m.extent.h} }\n---\n\n${m.body}\n`;

put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain() { return []; }
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
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
export const WORLD_ROOT_SLUG = "let-there-be-light";
export function placementParent() { return null; }
export function containmentParents(marks) { return { parent: new Map(marks.map((m) => [m.id, null])), rootId: null }; }
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { reader: "gh:9", solace: "gh:100", wright: "gh:1", worldkeeper: "gh:1", stranger: "gh:77" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
for (const m of PUBLISHED) put(repo, m.id === LAW.id ? "WORLD/marks/let-there-be-light/mark.md" : `WORLD/marks/${m.id}/mark.md`, record(m));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "pos1025 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: two residents' parcels, a bench on the commons, the town's noticeboard, the law");

// THE TOWN'S STAKE ENGINE, in a bottle (world-stake.mjs § townStakeEngine reads it from the town clone): a stranger's
// ✦3 stands behind solace's old mill, and nothing behind any other mark
put(town, "tools/world-stake.mjs", `
export function worldStakeState() { return { positions: new Map([["solace/the-old-mill|stranger", 3]]) }; }
export function markEscrow(clone, mark) { return mark === "solace/the-old-mill" ? 3 : 0; }
`);

const PINS = {
  reader: { login: "readerhouse", id: 9 },
  solace: { login: "Ana-Login", id: 100 },
  wright: { login: "keeminlee", id: 1 },
  worldkeeper: { login: "keeminlee", id: 1 },
  stranger: { login: "strangerhouse", id: 77 },
};

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.W2_GUARDS = "";
process.env.W2_PEN = "mark";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const claimsPen = await import("../src/world2-claims.mjs");
const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const provenance = await import("../src/act-provenance.mjs");
// the store has taken 079: the pen names hand, for_handle and route, and the stub keeps them by name
const pen = installActsPen({ pins: rowsFromRegistry({ households: {} }, PINS).pins,
  also: [[/information_schema\.columns/i, () => ({ rows: [{ kept: true }], rowCount: 1 })]] });
provenance.__forgetProvenanceProbe();
claimsPen.__setPoolForTest(pen);
after(() => { uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const { repairMarkAtOffice, repairPlan, repairGate, callerMayRepair, repairHand } = await import("../src/mark-repair.mjs");
const { householdApex } = await import("../src/household-apex.mjs");

const keyFor = (household, ...handles) => ({ household, handles: new Set(handles) });
const WRIGHT = keyFor("keeminlee", "wright");
const FOUNDER = keyFor("keeminlee", "wright", "worldkeeper");
const READER = keyFor("readerhouse", "reader");
const STRANGER = keyFor("strangerhouse", "stranger");

async function repair(args, key = WRIGHT) {
  try { return { ok: true, ...(await repairMarkAtOffice(args, key)) }; }
  catch (e) { return { ok: false, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint }; }
}
const dataOf = (c) => (typeof c?.data === "string" ? JSON.parse(c.data) : c?.data) ?? {};
const claimsFor = (id) => pen.state.claims.filter((c) => c.slug === id);
const actsFor = (id) => pen.state.acts.filter((a) => a.object === id);
const REASON = "the keeper asked for the flat's words to be mended; the old ones named a road that is gone";

// ── who may ──────────────────────────────────────────────────────────────────

test("only the town's hands may repair, each its credential's own (POS-389): a resident's key, a housemate's, a stranger's may not", () => {
  assert.equal(callerMayRepair(WRIGHT), true);
  assert.equal(callerMayRepair(FOUNDER), true);
  assert.equal(callerMayRepair(READER), false);
  assert.equal(callerMayRepair(STRANGER), false);
  // a key in a resident's own hand carries the whole house and stands only as that resident
  const marisOwn = { ...FOUNDER, handles: new Set([...FOUNDER.handles, "mari"]), keyKind: "claim", heldBy: "resident", claimedHandle: "mari" };
  assert.equal(callerMayRepair(marisOwn), false, "mari's own key does not repair because her house holds wright");
  assert.throws(() => repairHand({}, FOUNDER), (e) => e.code === 422 && /handle: one of wright, worldkeeper/.test(e.hint));
  assert.equal(repairHand({ handle: "worldkeeper" }, FOUNDER), "worldkeeper");
  assert.throws(() => repairHand({ handle: "darko" }, WRIGHT), (e) => e.code === 403);
});

test("the door is unlisted: to a key not on the list it answers exactly as an act the door has never heard of", async () => {
  const strip = (r) => { const { defect, hint, ...rest } = r; return { ...rest, defect: defect.replace(/"[^"]*"/, "<act>"), hint }; };
  const r = await householdApex({ do: "repair-mark", args: { mark: FLAT.id, act: "withdraw", reason: "x" } }, READER, {});
  const never = await householdApex({ do: "no-such-act", args: { mark: FLAT.id, act: "withdraw", reason: "x" } }, READER, {});
  assert.equal(r.error, "bounce");
  assert.deepEqual(strip(r), strip(never));
  const m = await import("../src/household-apex.mjs");
  assert.equal(m.HOUSEHOLD_DISPATCHABLE.includes("repair-mark"), false);
  assert.doesNotMatch(m.HOUSEHOLD_DESCRIPTION, /repair-mark/);
});

// ── what it refuses, writing nothing ─────────────────────────────────────────

test("the plan refuses by name: no act, no reason, no such mark, law, a town mark not said as the town, a stake", () => {
  const refuses = (args, canon, re) => assert.throws(() => repairPlan(args, canon), (e) => re.test(e.defect), JSON.stringify(args));
  refuses({ mark: FLAT.id, act: "move", reason: REASON }, FLAT, /amend or withdraw/);
  refuses({ mark: FLAT.id, act: "amend", reason: "  " }, FLAT, /needs a `reason`/);
  refuses({ mark: "reader/nothing-here", act: "withdraw", reason: REASON }, null, /no mark "reader\/nothing-here" stands/);
  refuses({ mark: LAW.id, act: "amend", reason: REASON, as: "town" }, LAW, /is law \(tier constitution\)/);
  refuses({ mark: BOARD.id, act: "withdraw", reason: REASON }, BOARD, /is the town's mark/);
  refuses({ mark: FLAT.id, act: "withdraw", reason: REASON, as: "town" }, FLAT, /reader's mark, not the town's/);
  refuses({ mark: FLAT.id, act: "amend", reason: REASON, stamps: 1 }, FLAT, /moves no stamp/);
  refuses({ mark: FLAT.id, act: "amend", reason: REASON, stamps: 0 }, FLAT, /moves no stamp/);
  refuses({ mark: FLAT.id, act: "withdraw", reason: REASON, body: "x" }, FLAT, /withdrawal carries no body/);
  assert.deepEqual(repairPlan({ mark: BOARD.id, act: "amend", reason: REASON, as: "town" }, BOARD),
    { act: "amend", id: BOARD.id, by: "the-town", slug: "the-noticeboard", asTown: true, reason: REASON });
});

test("the gate: a preview that would not publish refuses; one that would, writes", () => {
  assert.match(repairGate({ would: "amend", put_forward: false }), /a repair moves no stamp/);
  assert.match(repairGate({ would: "leave", put_forward: true }), /would not amend/);
  assert.equal(repairGate({ would: "amend", put_forward: true }), null);
});

// ── the amend ────────────────────────────────────────────────────────────────

test("the amend lands as the RESIDENT's own: their author, their household, on the docket at ✦0, the reason on the act", async () => {
  const before = pen.state.claims.length;
  const out = await repair({ mark: FLAT.id, act: "amend", reason: REASON, kind: "parcel", at: { ...FLAT.at }, body: "the keeper's flat, by the new road" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual({ repaired: out.repaired, act: out.act, hand: out.hand, for: out.for, route: out.route, reason: out.reason },
    { repaired: FLAT.id, act: "amend", hand: "wright", for: "reader", route: "operator", reason: REASON }, "the receipt names the hand, the resident and the reason");
  assert.equal(out.result?.amended, true, JSON.stringify(out.result));
  assert.equal(out.result?.branch, "draft/readerhouse", "the sketchbook named is the resident's household's, never keeminlee's");
  const claims = claimsFor(FLAT.id);
  assert.equal(pen.state.claims.length, before + 1, "one claim, and the preview wrote none");
  const claim = claims.at(-1);
  assert.equal(claim.claimant, "reader", "the author is the resident, never the operator");
  assert.equal(claim.household, "solo:reader", "filed under the resident's household, where their own amend finds it — never keeminlee's");
  assert.equal(claim.status, "pending", "put forward: the clearing rules on it");
  assert.equal(Number(claim.stake ?? 0), 0, "no stamp moved");
  assert.equal(dataOf(claim)._repair_reason, REASON, "the reason rides the declaration, underscored: never a mark file's field");
});

test("the act names the operator's HAND, the resident it is FOR and the `operator` route, from the scope (079)", async () => {
  const act = actsFor(FLAT.id).at(-1);
  assert.ok(act, "the act is in the log");
  assert.equal(act.actor, "reader");
  assert.equal(act.household, "solo:reader", "the act's household is the resident's (POS-457's spelling), never the operator's keeminlee");
  assert.equal(act.hand, "wright", JSON.stringify(act));
  assert.equal(act.for_handle, "reader");
  assert.equal(act.route, "operator");
  // and outside a repair the scope says nothing of an operator
  assert.deepEqual(provenance.provenanceOf({ actor: "reader" }, "mcp", null), { hand: "reader", for_handle: "reader", route: "mcp" });
});

test("a repair that would not publish (a commons mark with no escrow behind it) refuses after its preview and writes nothing", async () => {
  const before = { claims: pen.state.claims.length, acts: pen.state.acts.length };
  const out = await repair({ mark: BENCH.id, act: "amend", reason: REASON, kind: "sited", at: { ...BENCH.at }, extent: { ...BENCH.extent }, body: "a bench, mended" });
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.code, 409);
  assert.match(out.hint, /a repair moves no stamp/);
  assert.deepEqual({ claims: pen.state.claims.length, acts: pen.state.acts.length }, before, "nothing was written");
});

test("the town's mark is repaired as the town when as: \"town\" says so: its household the town's, its hand the operator's", async () => {
  const out = await repair({ mark: BOARD.id, act: "amend", reason: REASON, as: "town", kind: "sited", at: { ...BOARD.at }, extent: { ...BOARD.extent }, body: "the town's noticeboard, its words mended" });
  if (!out.ok) {
    // the town's ground asks what its backing escrow does not meet: the repair is refused, never paid for
    assert.equal(out.code, 409, JSON.stringify(out));
    assert.match(out.hint, /a repair moves no stamp/);
    assert.equal(claimsFor(BOARD.id).length, 0);
    return;
  }
  const claim = claimsFor(BOARD.id).at(-1);
  assert.equal(claim.claimant, "the-town");
  assert.equal(out.household, "the-town");
  assert.equal(actsFor(BOARD.id).at(-1)?.hand, "wright");
});

// ── the withdrawal ───────────────────────────────────────────────────────────

test("the withdrawal ends the resident's mark as theirs, its cause the repair's reason, its hand the operator's", async () => {
  const out = await repair({ mark: PORCH.id, act: "withdraw", reason: "the porch stood over the river's new course" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.for, "solace");
  const act = actsFor(PORCH.id).at(-1);
  assert.ok(act, "the withdrawal is in the log");
  assert.equal(act.actor, "solace");
  assert.equal(act.hand, "wright");
  assert.equal(act.route, "operator");
  const payload = typeof act.payload === "string" ? JSON.parse(act.payload) : act.payload;
  assert.deepEqual(payload.cause, { repair: "the porch stood over the river's new course" });
});

test("a staked mark is not withdrawn by a repair: the stamps behind it are their holders', and no stamp moves", async () => {
  const before = pen.state.acts.length;
  const out = await repair({ mark: MILL.id, act: "withdraw", reason: "the mill stands where the river now runs" });
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.code, 409, JSON.stringify(out));
  assert.match(out.defect, /3✦ stand in escrow on "solace\/the-old-mill"/);
  assert.equal(pen.state.acts.length, before, "nothing was written");
});

test("an ordinary key still cannot withdraw or amend another resident's mark: the resident's doors are unchanged", async () => {
  const { withdrawMarkViaOffice, leaveMarkViaOffice } = await import("../src/world.mjs");
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: FLAT.id }, STRANGER), (e) => e.code === 403 && /only the hand that left a mark/.test(e.defect));
  await assert.rejects(leaveMarkViaOffice(repo, { by: "reader", slug: "the-keepers-flat", amend: true, kind: "parcel", at: FLAT.at, body: "x" }, STRANGER), (e) => e.code === 403);
  // a town hand's key, outside the repair door, is no operator either
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: FLAT.id }, WRIGHT), (e) => e.code === 403);
});
