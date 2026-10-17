// taken-to-drafts.test.mjs — A MARK THE SETTLEMENT TAKES GOES BACK TO ITS
// HOUSEHOLD'S DRAFTS, AND THE HOUSEHOLD IS TOLD (WLD-51 ruling 2).
//
//   G1 (Darko, 2026-10-15 13:00): "When the settlement takes a mark, it writes
//   the mark back to its household as a private draft claim (`claims.status =
//   'draft'`) at its last place, with nothing staked behind it. It then shows
//   in their drafts, and staking it or putting it forward brings it back."
//
//   G3 (Darko, 2026-10-15 12:59): "every taken mark gets a doorstep and
//   needs-you note for 7 days, or until it's put forward again; no letter."
//
//   node --test test/taken-to-drafts.test.mjs
//
// THE RIG is carry-at-the-clearing.test.mjs's: a real Postgres
// (test/helpers/embedded-store.mjs) with the whole schema, 076 included, and the
// real `retire-unpublished.mjs` and `clearing-job.mjs` run as children under the
// `clearing_job` pen, because the return is an insert that pen is narrowed to by
// a trigger and a row policy, and only Postgres can say what they let in.
//
// The fixture: Rei's garage stands on open ground, locked at WIN-1 by a claim
// whose data carries the docket's plumbing (`_act_id`, `_journal_seq`) and a
// file's (`_fileAt`). The sweep took it (the report names it).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { alertsFor } from "../src/alerts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RETIRE = join(ROOT, "world2", "tools", "retire-unpublished.mjs");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 240;
// The open window's opening, as prod's windows open: 05:45:40Z, fourteen minutes
// and twenty seconds before the 06:00Z settlement that took the mark. A window
// opening on the dot would hide which of the two the note names (review 4a).
const OPENED = new Date(Date.UTC(2026, 9, 7, 5, 45, 40));

const store = await startStore({ db: "taken_to_drafts_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const scratch = mkdtempSync(join(tmpdir(), "taken-to-drafts-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const IDS = {
  garage: "c0000000-0000-4000-8000-000000000001",
  lamp: "c0000000-0000-4000-8000-000000000002",
  ghost: "c0000000-0000-4000-8000-000000000003",
};
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const AT = { x: 4000, y: 4000 }, EXT = { w: 4, h: 4 };

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(OPENED.getTime() + (id - WIN) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      // starforge lists rei's account, as prod's houses do: gh:201 is one of its spellings (024)
      `INSERT INTO households (slug, ord, name, residents, since, declared_by, accounts)
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei', '[{"id": 201, "login": "rei"}]'),
              ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable', '[]')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('rei', 'rei', 201, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    const mark = async (id, slug, owner, household, at, data) => {
      const geometry = JSON.stringify({ at, extent: EXT });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, 'sited', $3, $4, 'locked', now(), $5, $6, $7::box, 1, $8, $9)`,
        [id, WIN - 1, owner, household, `${slug}, as it stood.`, geometry, box(at, EXT), JSON.stringify(data), slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, 'standing', $8, $9)`,
        [id, slug, owner, household, `${slug}, as it stood.`, geometry, box(at, EXT), WIN - 1, JSON.stringify(data)]);
    };
    await mark(IDS.garage, "rei/the-garage", "rei", "hh:starforge", AT,
      { by: "rei", date: "2026-10-01", colour: "green", _act_id: "51", _journal_seq: 7, _fileAt: { x: 1, y: 1 } });
    await mark(IDS.lamp, "sable/the-lamp", "sable", "hh:rabbit", { x: 4100, y: 4000 }, { by: "sable", date: "2026-10-01" });
    // an owner the town's roll does not name
    await mark(IDS.ghost, "ghost/the-lantern", "ghost", "hh:starforge", { x: 4200, y: 4000 }, { by: "ghost", date: "2026-10-01" });
  });
}

function retire(slugs) {
  const sweep = join(scratch, `sweep-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(sweep, JSON.stringify({ unpublished: slugs.map((id) => ({ id })) }));
  const r = spawnSync(process.execPath, [RETIRE, "--sweep", sweep], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* the assertion below prints it */ }
  return { code: r.status, out, raw: `${r.stdout}\n${r.stderr}` };
}
const draftsOf = (slug) => read("SELECT id::text, status, claimant, household, stake, slug, class, body, geometry, data, window_id, supersedes FROM claims WHERE status = 'draft' AND slug = $1", [slug]);

// The household's own view: office_api, with the house declared, as the door reads my-drafts.
async function asHouse(keys, fn) {
  const c = await store.connect("office_api");
  try {
    await c.query("BEGIN");
    if (keys) await c.query("SELECT set_config('app.household_keys', $1, true)", [keys.join(",")]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { await c.end(); }
}

test("G1: the take writes the mark back as a private draft of its author, at its last place, at ✦0, with the plumbing left behind", { skip }, async () => {
  await seed();
  const run = retire(["rei/the-garage"]);
  assert.equal(run.code, 0, run.raw);
  assert.deepEqual(run.out.retired.map((r) => r.slug), ["rei/the-garage"]);
  assert.deepEqual(run.out.drafts, { returned: [{ slug: "rei/the-garage", household: "hh:starforge" }], kept: [], unreturned: [] });

  const [m] = await read("SELECT status, retired_window, retired_cause FROM marks WHERE id = $1", [IDS.garage]);
  assert.deepEqual(m, { status: "retired", retired_window: WIN, retired_cause: "settlement-unpublish" }, "076: the store says which door it left by");

  const [d, ...more] = await draftsOf("rei/the-garage");
  assert.equal(more.length, 0);
  assert.deepEqual([d.status, d.claimant, d.household, d.stake, d.class, d.body, d.window_id, d.supersedes],
    ["draft", "rei", "hh:starforge", 0, "sited", "rei/the-garage, as it stood.", WIN, null]);
  assert.deepEqual(d.geometry, { slug: "rei/the-garage", at: AT, extent: EXT }, "at its last place, in the door's draft shape");
  assert.deepEqual(d.data, { by: "rei", date: "2026-10-01", colour: "green", _returned: { mark: IDS.garage, window: WIN, cause: "settlement-unpublish" } },
    "what its author declared rides; the act's pairing keys and the file's numbers do not");

  const mine = await asHouse(["hh:starforge"], async (c) => (await c.query("SELECT slug FROM claims WHERE status = 'draft'")).rows.map((r) => r.slug));
  assert.deepEqual(mine, ["rei/the-garage"], "it shows in the household's drafts");
  const stranger = await asHouse(["hh:rabbit"], async (c) => (await c.query("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'")).rows[0].n);
  assert.equal(stranger, 0, "and to no other house: it is a private draft (007/024)");
  const publicRead = await asHouse(null, async (c) => (await c.query("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'")).rows[0].n);
  assert.equal(publicRead, 0);
});

test("NOTHING TWICE: a re-run retires nothing and returns nothing; a house that already holds a draft of the mark keeps its own", { skip }, async () => {
  await seed();
  // the house composed an amend of the lamp while it stood: that draft IS the lamp in its drafts
  await asHouse(["hh:rabbit"], (c) => c.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug)
     VALUES ($1, 'sited', 'sable', 'hh:rabbit', 'draft', 'the lamp, relit', $2, 0, '{"date":"2026-10-14"}', 'sable/the-lamp')`,
    [WIN, JSON.stringify({ slug: "sable/the-lamp", at: { x: 4100, y: 4000 }, extent: EXT })]));
  const first = retire(["rei/the-garage", "sable/the-lamp"]);
  assert.equal(first.code, 0, first.raw);
  assert.deepEqual(first.out.drafts.returned.map((r) => r.slug), ["rei/the-garage"]);
  assert.deepEqual(first.out.drafts.kept, [{ slug: "sable/the-lamp" }]);
  const lamp = await draftsOf("sable/the-lamp");
  assert.deepEqual(lamp.map((r) => r.body), ["the lamp, relit"], "the house's own draft stands, alone");

  const again = retire(["rei/the-garage", "sable/the-lamp"]);
  assert.equal(again.code, 0, again.raw);
  assert.deepEqual(again.out.retired, []);
  assert.deepEqual(again.out.already_retired.map((r) => r.slug), ["rei/the-garage", "sable/the-lamp"]);
  assert.deepEqual(again.out.drafts, { returned: [], kept: [], unreturned: [] });
  assert.equal((await draftsOf("rei/the-garage")).length, 1, "still one draft of the garage");
});

test("AN OWNER THE ROLL DOES NOT NAME: the mark is retired, named unreturned, and nothing else waits on it", { skip }, async () => {
  await seed();
  const run = retire(["ghost/the-lantern", "rei/the-garage"]);
  assert.equal(run.code, 0, run.raw);
  assert.deepEqual(run.out.retired.map((r) => r.slug), ["ghost/the-lantern", "rei/the-garage"]);
  assert.deepEqual(run.out.drafts.returned.map((r) => r.slug), ["rei/the-garage"]);
  assert.deepEqual(run.out.drafts.unreturned.map((r) => r.slug), ["ghost/the-lantern"]);
  assert.match(run.out.drafts.unreturned[0].why, /roll does not name ghost/);
  assert.equal((await draftsOf("ghost/the-lantern")).length, 0);
});

test("THE PEN IS NARROW (076): clearing_job may plant only the return of a mark the sweep retired, by its owner, in the mark's own house and window, once per take", { skip }, async () => {
  await seed();
  // The take, set by hand so no return has been written yet (the control must be lawful):
  // the garage retired by the sweep at WIN; the lamp retired by marks-ingest at WIN;
  // the lantern, standing again with an old take's cause and window (a revive's shape,
  // its window kept so that only the status clause stands between it and the pen).
  await owner(async (c) => {
    await c.query("UPDATE marks SET status = 'retired', retired_window = $1, retired_cause = 'settlement-unpublish' WHERE id = $2", [WIN, IDS.garage]);
    await c.query("UPDATE marks SET status = 'retired', retired_window = $1, retired_cause = 'marks-ingest' WHERE id = $2", [WIN, IDS.lamp]);
    await c.query("UPDATE marks SET status = 'standing', retired_window = $1, retired_cause = 'settlement-unpublish', owner = 'rei' WHERE id = $2", [WIN, IDS.ghost]);
  });
  const c = await store.connect("clearing_job");
  const garage = { slug: "rei/the-garage", claimant: "rei", household: "hh:starforge", mark: IDS.garage };
  const plant = async ({ slug, claimant, household, mark, keys = household, stake = 0, window = WIN, said = window }, { keep = false } = {}) => {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.household_keys', $1, true)", [keys]);
      await c.query(
        `INSERT INTO claims (window_id, slug, class, claimant, household, status, body, geometry, stake, data)
         VALUES ($1, $2, 'sited', $3, $4, 'draft', 'x', '{}', $5, $6)`,
        [window, slug, claimant, household, stake, JSON.stringify({ _returned: { mark, window: said, cause: "settlement-unpublish" } })]);
      if (keep) await c.query("COMMIT");
      return "inserted";
    } catch (e) { return e.message; } finally { await c.query("ROLLBACK").catch(() => {}); }   // after a COMMIT, a no-op
  };
  const REFUSED = /clearing_job may insert only/;
  try {
    assert.equal(await plant(garage), "inserted", "the control: the lawful return");
    assert.match(await plant({ ...garage, household: "hh:rabbit" }), REFUSED,
      "the reviewer's plant: another house the pen declared itself (review-220-577 2b read \"inserted\")");
    assert.match(await plant({ ...garage, keys: "hh:rabbit,hh:starforge", household: "hh:rabbit" }), REFUSED, "and with the mark's own house declared beside it");
    assert.match(await plant({ ...garage, claimant: "sable" }), REFUSED, "only to its own author");
    assert.match(await plant({ ...garage, stake: 1 }), REFUSED, "at ✦0");
    assert.match(await plant({ slug: "sable/the-lamp", claimant: "sable", household: "hh:rabbit", mark: IDS.lamp }), REFUSED,
      "a mark marks-ingest retired is not a take (the cause clause)");
    assert.match(await plant({ slug: "ghost/the-lantern", claimant: "rei", household: "hh:starforge", mark: IDS.ghost }), REFUSED,
      "a mark standing again keeps its old cause, and is never returned (the status clause)");
    assert.match(await plant({ ...garage, slug: "rei/the-garage-again" }), REFUSED, "the claim carries the mark's own slug (the slug clause)");
    assert.match(await plant({ ...garage, window: WIN - 1, said: WIN }), REFUSED, "a return is written in its take's window");
    assert.match(await plant({ ...garage, window: WIN - 1, said: WIN - 1 }), REFUSED, "a return belongs to its take's window");
    assert.match(await plant({ ...garage, said: WIN - 1 }), REFUSED, "and says which take it returns");
    assert.match(await plant({ ...garage, keys: "hh:rabbit" }), /row-level security/, "in a transaction that declared the house");
    assert.equal(await plant(garage, { keep: true }), "inserted", "the first return, kept");
    assert.match(await plant(garage), REFUSED, "a second return of the same take is refused");
  } finally { await c.end(); }
});

test("G1, THE ROUND TRIP: staked, the returned draft goes pending, and the clearing stands the same mark back up", { skip }, async () => {
  await seed();
  assert.equal(retire(["rei/the-garage"]).code, 0);
  // the stake door's SUBMIT (world2-claims.mjs § promoteDraftOnStake), as the
  // household: draft -> pending in the open window, with the stamp on the ledger
  await asHouse(["hh:starforge"], (c) => c.query(
    "UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(), stake = 1 WHERE status = 'draft' AND slug = 'rei/the-garage'", [WIN]));
  await owner((c) => c.query(
    `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
     VALUES ($1, 'rei/the-garage', 'rei', 'hh:starforge', 'hh:starforge', 1, 0)`, [TOWN_SHA]));
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const [m] = await read("SELECT id::text, status, retired_window, geometry FROM marks WHERE slug = 'rei/the-garage'");
  assert.deepEqual([m.id, m.status, m.retired_window], [IDS.garage, "standing", null], "a mark keeps one id for life: revived, not a second row");
  assert.deepEqual(m.geometry.at, AT);
});

// The store as alerts.mjs reads it, and world main as a set of ids.
const storeReader = () => async () => ({ query: async (text, args) => ({ rows: await read(text, args) }) });
const ask = (handles, now, worldIds = async () => new Set()) => alertsFor(handles, { now, store: storeReader(), worldIds });

test("G3, THE ALERT (mark-taken): for the house that owns it, for 14 settlements, until it is put forward again; never for a file-side retirement", { skip }, async () => {
  await seed();
  assert.equal(retire(["rei/the-garage", "sable/the-lamp"]).code, 0);
  // a mark marks-ingest retired (a file-side change on main) is not a take
  await owner((c) => c.query("UPDATE marks SET status = 'retired', retired_window = $1, retired_cause = 'marks-ingest' WHERE id = $2", [WIN, IDS.ghost]));
  const at = "2026-10-07T06:00:00.000Z";   // the settlement, never the window's opening (05:45:40Z)
  const until = "2026-10-14T06:00:00.000Z"; // 14 settlements on

  const now = new Date(OPENED.getTime() + 3600e3);
  assert.deepEqual(await ask(["rei", "ghost"], now), { alerts: [{
    kind: "mark-taken", severity: "act",
    about: { mark: "rei/the-garage", body: "rei/the-garage, as it stood." },
    message: "rei/the-garage had no stamps behind it, so it left the world at the Oct 7, 2:00 am EDT settlement. It's back in your household's drafts, and its author, rei, can stake it, or leave it again with a stamp, to bring it back.",
    act: { verb: "world.stake", args: { mark: "rei/the-garage", stamps: 1, handle: "rei" } },
    since: at, until,
  }], unread: [] }, "the house's own take only: not sable's lamp, not the ingest's lantern");
  assert.deepEqual((await ask(["rei"], new Date(Date.parse(until)))).alerts, [], "gone at the 14th settlement");
  assert.deepEqual((await ask(["rei"], new Date(Date.parse(until) - 1000))).alerts.map((a) => a.about.mark), ["rei/the-garage"], "still there a second before");

  // put forward again: the draft goes pending on the open docket
  await asHouse(["hh:starforge"], (c) => c.query(
    "UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(), stake = 1 WHERE status = 'draft' AND slug = 'rei/the-garage'", [WIN]));
  assert.deepEqual((await ask(["rei"], now)).alerts, [], "put forward again, the alert is gone");
});

test("THE ALERT (escrow-on-missing-mark): stamps on a mark that isn't in the world, the holder's own; never a mark that stands, is being put forward, or is on world main", { skip }, async () => {
  await seed();
  assert.equal(retire(["rei/the-garage"]).code, 0);   // retired; its returned DRAFT stays, and a draft is not asked about (review F2)
  await owner(async (c) => {
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug)
                   VALUES ($1, 'sited', 'sable', 'hh:rabbit', 'pending', 'put forward', '{}', 1, '{}', 'sable/the-new-kite')`, [WIN]);
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES
      ($1, 'rei/the-garage', 'rei', 'hh:starforge', 'hh:starforge', 2, 0),
      ($1, 'caelum-reeves/the-sky-side', 'rei', 'hh:starforge', 'hh:starforge', 5, 0),
      ($1, 'sable/the-lamp', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0),
      ($1, 'sable/the-new-kite', 'sable', 'hh:rabbit', 'hh:rabbit', 1, 0),
      ($1, 'rei/on-main-only', 'rei', 'hh:starforge', 'hh:starforge', 3, 0),
      ($1, 'lu-yu/call-it-yu-tai', 'sable', 'hh:rabbit', 'hh:rabbit', 1, 0)`, [TOWN_SHA]);
  });
  const now = new Date(OPENED.getTime() + 15 * 24 * 3600e3);   // past the take's 14 settlements: only this kind speaks
  const out = await ask(["rei"], now, async () => new Set(["rei/on-main-only"]));
  assert.deepEqual(out.alerts.map((a) => [a.kind, a.severity, a.about.mark, a.about.body, a.message, a.act, a.since, a.until]), [
    ["escrow-on-missing-mark", "info", "caelum-reeves/the-sky-side", null, "✦5 on caelum-reeves/the-sky-side, which isn't in the world; unstake to bring it home",
      { verb: "world.unstake", args: { mark: "caelum-reeves/the-sky-side", stamps: 5, handle: "rei" } }, null, null],
    ["escrow-on-missing-mark", "info", "rei/the-garage", "rei/the-garage, as it stood.", "✦2 on rei/the-garage, which isn't in the world; unstake to bring it home",
      { verb: "world.unstake", args: { mark: "rei/the-garage", stamps: 2, handle: "rei" } }, null, null],
  ], "a mark that never stood and a retired one; not sable's standing lamp, not a mark on world main, not another holder's");
  assert.deepEqual((await ask(["sable"], now)).alerts.map((a) => a.about.mark), ["lu-yu/call-it-yu-tai"], "a mark being put forward is not missing");
});

test("G1, ITS HOUSEHOLD: the draft goes to the house the mark stood in, under the spelling it stood under, and that house sees it", { skip }, async () => {
  await seed();
  // a mark of rei's that stood under the house's older spelling (her GitHub id, 024's set)
  const SHED = "c0000000-0000-4000-8000-000000000004";
  await owner(async (c) => {
    const geometry = JSON.stringify({ at: { x: 4300, y: 4000 }, extent: EXT });
    await c.query(`INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
                   VALUES ($1, $2, 'sited', 'rei', 'gh:201', 'locked', now(), 'a shed', $3, $4::box, 1, '{}', 'rei/the-old-shed')`,
      [SHED, WIN - 1, geometry, box({ x: 4300, y: 4000 }, EXT)]);
    await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                   VALUES ($1, 'rei/the-old-shed', 'sited', 'rei', 'gh:201', 'a shed', $2, $3::box, 'standing', $4, '{}')`,
      [SHED, geometry, box({ x: 4300, y: 4000 }, EXT), WIN - 1]);
  });
  const run = retire(["rei/the-old-shed"]);
  assert.equal(run.code, 0, run.raw);
  assert.deepEqual(run.out.drafts.returned, [{ slug: "rei/the-old-shed", household: "gh:201" }], "the mark's own house, never a house the pen chose");
  const { sessionKeysVia } = await import("../src/household-deriver.mjs");
  const keys = await owner((c) => sessionKeysVia({ query: (t, a) => c.query(t, a) }, "hh:starforge"));
  const seen = await asHouse(keys, async (c) => (await c.query("SELECT slug, household FROM claims WHERE status = 'draft'")).rows);
  assert.deepEqual(seen, [{ slug: "rei/the-old-shed", household: "gh:201" }], `the house reads it under its spelling set (${keys.join(", ")})`);
});
