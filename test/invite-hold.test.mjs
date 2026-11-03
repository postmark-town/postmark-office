// invite-hold.test.mjs — the hands' hold on an inviter's payout (POS-816), through the town door.
//   node --import ./test/helpers/sparse-guard.mjs --test test/invite-hold.test.mjs
//   INVITE_TOWN_CLONE=<a town checkout carrying --invite-mint> for the evidence read's ledger arm
//
// Darko, 2026-11-02 23:56 ("calls are good. continue with the calls as stated"):
// an office act checked by account, the bug-stage hands' pattern, Little Bird's
// account with Darko as her backup; a held payout waits until it is lifted;
// lifting and cancelling each need a reason. Little Bird, 2026-10-30: "the hold
// itself is placed from Little Bird's own account"; "Always with a reason."
// Every household and key here is invented.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "invite_hold_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;
const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

let callTool, invitesAtOffice, inviteStoreFacts;
if (!skip) {
  await asOwner("TRUNCATE households, household_pins CASCADE");
  await asOwner(
    `INSERT INTO households (slug, ord, name, residents, since, declared_by, invited_by)
     VALUES ('keep', 0, 'The Keep', ARRAY['dora'], '2026-10-27', 'dora', '{"by":"castle","named":"cleo","at":"2026-10-27T20:39:04.552Z"}'::jsonb),
            ('castle', 1, 'Castle', ARRAY['carl','cleo'], '2026-09-30', 'carl', NULL),
            ('tower', 2, 'Tower', ARRAY['tess'], '2026-10-01', 'tess', NULL),
            ('nest', 3, 'The Nest', ARRAY['little-bird'], '2026-07-01', 'little-bird', NULL),
            ('starforge', 4, 'Starforge', ARRAY['keemin','wright'], '2026-07-01', 'keemin', NULL)`);
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  ({ callTool } = await import("../src/mcp.mjs"));
  ({ invitesAtOffice } = await import("../src/invite-hold-store.mjs"));
  ({ inviteStoreFacts } = await import("../src/invite-facts.mjs"));
}

// the credentials: a human's own sign-in holds its house's handles; a resident's own key only its own
const littleBird = { household: "the-nest", handles: new Set(["little-bird"]) };
const darko = { household: "the-founders", handles: new Set(["keemin", "wright"]) };
const wrightsOwnKey = { household: "the-founders", handles: new Set(["keemin", "wright"]), heldBy: "resident", claimedHandle: "wright" };
const resident = { household: "the-tower", handles: new Set(["tess"]) };
const inviter = { household: "the-castle", handles: new Set(["carl", "cleo"]) };

const town = (args, key) => callTool("town", args, { key });
const move = (post, to, note, key = littleBird, handle) => town({ do: "advance", args: { post, to, ...(note != null ? { note } : {}) }, ...(handle ? { handle } : {}) }, key);
const holdRow = async () => (await asOwner("SELECT state, moves FROM invite_holds WHERE household = 'keep'"))[0] ?? null;
const fresh = () => asOwner("TRUNCATE invite_holds");
const bounceOf = (r) => (r?.error ? r : r?.result?.error ? r.result : null);

test("FALSIFIER: Little Bird holds an inviter's payout through the town door, with her reason, and it is kept privately", { skip }, async () => {
  await fresh();
  const r = await move("invite:keep", "held", "three joins in an hour naming castle", littleBird, "little-bird");
  assert.equal(r.did, "advance", JSON.stringify(r).slice(0, 400));
  assert.equal(r.result.moved, "invite:keep");
  assert.deepEqual([r.result.from, r.result.to, r.result.by], ["open", "held", "little-bird"]);
  const row = await holdRow();
  assert.equal(row.state, "held");
  assert.equal(row.moves.length, 1);
  assert.deepEqual({ ...row.moves[0], at: "-" }, { from: "open", to: "held", note: "three joins in an hour naming castle", hand: "little-bird", at: "-" });
  // PRIVATE: no export role reads it (086), and it is never an act
  const [g] = await asOwner("SELECT has_table_privilege('snapshot_reader', 'invite_holds', 'SELECT') AS snap, has_table_privilege('office_api', 'invite_holds', 'UPDATE') AS api");
  assert.deepEqual(g, { snap: false, api: true });
  assert.equal(Number((await asOwner("SELECT count(*)::int AS n FROM acts WHERE object = 'invite:keep'"))[0].n), 0, "never an act: acts are published");
});

test("checked by account: a resident, the inviter itself, and a hand's housemate's own key are refused, and learn nothing", { skip }, async () => {
  await fresh();
  for (const [who, key, handle] of [["a resident", resident], ["the inviting house", inviter], ["Wright's own resident key, though Darko's house", wrightsOwnKey, "keemin"]]) {
    const r = await move("invite:keep", "held", "trying", key, handle);
    const b = bounceOf(r);
    assert.ok(b, `${who}: refused`);
    assert.equal(b.code, 404, `${who}: the same answer as an invitation that does not exist`);
    assert.match(b.defect, /no post "invite\/keep"/, who);
  }
  assert.equal(await holdRow(), null, "nothing written");
  // the control: Darko's own sign-in, his backup, may
  const r = await move("invite:keep", "held", "Little Bird is away; holding for her", darko, "keemin");
  assert.equal(r.result?.to, "held", JSON.stringify(r).slice(0, 300));
});

test("every move carries a reason; held waits until lifted; cancelled is final", { skip }, async () => {
  await fresh();
  const noReason = bounceOf(await move("invite:keep", "held", null));
  assert.equal(noReason.code, 422);
  assert.match(noReason.defect, /each carry a reason/);
  assert.equal((await move("invite:keep", "held", "looks like a second account")).result.to, "held");
  assert.equal(bounceOf(await move("invite:keep", "lifted", null)).code, 422, "a lift needs its reason too");
  assert.equal((await move("invite:keep", "lifted", "spoke with them; a real friend")).result.to, "lifted");
  assert.equal((await move("invite:keep", "cancelled", "the same person as castle after all", darko, "keemin")).result.to, "cancelled");
  const final = bounceOf(await move("invite:keep", "lifted", "changed my mind"));
  assert.equal(final.code, 409);
  assert.match(final.defect, /cancelled payout is final/);
  const row = await holdRow();
  assert.equal(row.state, "cancelled");
  assert.deepEqual(row.moves.map((m) => `${m.from}>${m.to}:${m.hand}`), ["open>held:little-bird", "held>lifted:little-bird", "lifted>cancelled:keemin"], "every move kept, oldest first");
});

test("the id is no resident's post: an advance on invite/<slug> (a resident called invite's post) never reaches the hold", { skip }, async () => {
  await fresh();
  const r = await move("invite/keep", "held", "a slash, as a resident's post id is written");
  assert.ok(bounceOf(r), "the ordinary post path answers, not the hold");
  assert.doesNotMatch(JSON.stringify(r), /payout|invitations' holds/, "nothing about a hold in the answer");
  assert.equal(await holdRow(), null, "and nothing held");
  // the control: the colon is the invitation's own id
  assert.equal((await move("invite:keep", "held", "the invitation's own id")).result?.to, "held");
});

test("an invitation the store does not record is not found, even for a hand", { skip }, async () => {
  await fresh();
  for (const post of ["invite:tower", "invite:nobody"]) {
    const b = bounceOf(await move(post, "held", "checking"));
    assert.equal(b?.code, 404, post);
  }
});

test("the read is the hands': a resident is refused; the pay pass's store read sees the hold and its moves", { skip }, async () => {
  await fresh();
  await move("invite:keep", "held", "a burst of joins");
  const asResident = await town({ read: "posts", args: { class: "invite" } }, resident);
  assert.equal(bounceOf(asResident)?.code ?? asResident.code, 403, JSON.stringify(asResident).slice(0, 300));
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try {
    const facts = await inviteStoreFacts(async (sql, params) => (await c.query(sql, params)).rows);
    assert.deepEqual(facts.rows.map((r) => [r.slug, r.invited_by.by]), [["keep", "castle"]]);
    assert.equal(facts.holds.get("keep").state, "held");
    assert.equal(facts.holds.get("keep").moves[0].note, "a burst of joins");
  } finally { await c.end(); }
  // without a town clone the hand's read says honestly that it cannot see what is paid
  const honest = await invitesAtOffice({}, littleBird, {});
  assert.equal(honest.invitations, null);
  assert.match(honest.unavailable, /could not be read with an invite grammar/);
});

const INVITE_TOWN = process.env.INVITE_TOWN_CLONE || null;
test(`the hand's read shows each invitation's evidence and both sides, against the town's ledger ${INVITE_TOWN ? "" : "(skipped: needs postmark#4424's invite grammar: set INVITE_TOWN_CLONE)"}`, { skip: skip || (INVITE_TOWN ? false : "needs postmark#4424's invite grammar (unshipped): set INVITE_TOWN_CLONE") }, async () => {
  await fresh();
  await move("invite:keep", "held", "a burst of joins");
  const repo = mkdtempSync(join(tmpdir(), "invite-hold-town-"));
  try {
    mkdirSync(join(repo, "tools"), { recursive: true });
    mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
    copyFileSync(join(INVITE_TOWN, "tools", "stamp-mint.mjs"), join(repo, "tools", "stamp-mint.mjs"));
    writeFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "# stamp-ledger\n\n- 2026-06-12 · rules: stamps-v1 · sig: x\n- 2026-10-28 · MINT → dora · 5 · for: welcome:hh:keep · by: the-town · sig: x\n");
    const r = await invitesAtOffice({}, littleBird, { clone: repo, now: new Date("2026-11-01T00:00:00.000Z") });
    assert.equal(r.class, "invite");
    assert.equal(r.total, 1);
    const [p] = r.invitations;
    assert.equal(p.invitation, "invite:keep");
    assert.equal(p.invited_by, "castle");
    assert.deepEqual(p.welcome, { paid: "2026-10-28", to: "dora" }, "what its welcome already paid");
    assert.equal(p.invited_side.status, "owed");
    assert.equal(p.hold.state, "held");
    assert.equal(p.inviter_side.status, "waiting", "no first letter or home in this store: the 30 days still running");
    assert.match(r.read_at, /^2026-11-01T/, "the reading's own time");
    const one = await invitesAtOffice({ post: "invite:keep" }, darko, { clone: repo, now: new Date("2026-11-01T00:00:00.000Z") });
    assert.equal(one.invitation.household, "keep");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
