// dev-rehearsal-local.test.mjs — the dev rehearsal, end to end, on a local
// stand-in for the dev office (POS-354, part 5).
//
// test/helpers/dev-target.mjs builds what the box holds for dev: an embedded
// Postgres with every migration in this tree, scratch clones of this tree's town
// and world (no remotes), office.db hydrated and the town index in the store, the
// dev office's env file and the pens file, and this tree's office booted on them.
// Then tools/dev-rehearsal.mjs runs against it exactly as Wright runs it on the
// box: through the office's doors, the box's own jobs, and checks that read the store.
//
// HEAVY: minutes (a hydrate, a crossing, a clearing, three settlements with the
// world's checker suite). Locally it runs through `node G:/Postmark/pool/run-heavy.mjs`.
// A store that cannot start FAILS with the reason (embedded-store.mjs § NO_STORE).
//
// THE MISTS AT THEIR LAST KEYFRAME (POS-595). The stand-in's world has its Mists
// schedule moved so the wall stands at its last front now (dev-target.mjs §
// mistsAtLastKeyframe): to the wall, the crossing this runs at is one past the
// schedule's end. Until 10-12 the rehearsal claimed fixed ground at x 30000,
// which the wall has covered since crossing 244 (the door's 422); it now finds
// its ground in the preflight, and this run claims, clears and settles there.
//
// In CI it runs under its own cap (.github/scripts/suite-lib.mjs § a file's own
// cap): about 3× its measured CI time (169 s on 10-09 before the whole crossing
// came in, past 180 s after). Raise it when the rehearsal's chain grows.
// suite-file-timeout: 600000

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { localDevTarget } from "./helpers/dev-target.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PROD_DB, groundOf, groundTakenIn, mistsSafeBox, runRehearsal, renderReport, storeClients, targetFromFiles } from "../tools/dev-rehearsal.mjs";
import { OVERLAP } from "../world2/tools/overlap.mjs";
import { boxOf } from "../world2/tools/seed-import.mjs";
import { publishedSkeleton } from "../src/world-branches.mjs";

let dev;
before(async () => { dev = await localDevTarget({ mistsAtLastKeyframe: true }); }, { timeout: 20 * 60_000 });
after(async () => { await dev?.stop(); });

const target = (extra = {}) => ({ ...targetFromFiles({ envFile: dev.envFile, rolesFile: dev.rolesFile, office: dev.officeBase, prodPubKey: dev.prodKey }), ...extra });

test("the rehearsal refuses a pen pointed at PROD's database before it writes anything", async () => {
  const t = target();
  t.urls = { ...t.urls, clearing_job: t.urls.clearing_job.replace(/\/[^/]+$/, `/${PROD_DB}`) };
  const lines = [];
  const r = await runRehearsal(t, { log: (l) => lines.push(l) });
  assert.equal(r.green, false);
  assert.equal(r.setup_failed, true);
  assert.match(lines[0], /^dev-rehearsal: REFUSED, the target store is not the dev office's own: clearing_job names world2_dev, PROD's store/);
  assert.equal(r.steps.length, 0, "no step ran");
});

test("the preflight goes red on a dev office that does not read the store as prod's does", async () => {
  const t = target();
  t.env = { ...t.env, OFFICE_PAPERWORK_STORE: undefined, STAMP_KEY: undefined };
  const r = await runRehearsal(t, { only: ["preflight"] });
  assert.equal(r.green, false);
  const pre = r.steps.find((s) => s.id === "preflight");
  assert.ok(pre.problems.some((p) => /without OFFICE_PAPERWORK_STORE=1/.test(p)), pre.problems.join("; "));
  assert.ok(pre.problems.some((p) => /sets no STAMP_KEY, so its pens sign with PROD's key file/.test(p)), pre.problems.join("; "));
});

test("the preflight goes red when dev's key is prod's, and when the dev clone is not on dev's key (POS-354)", async () => {
  // the 10-07 instance: the dev root's key was a byte-identical copy of prod's
  const t = target();
  t.env = { ...t.env, STAMP_KEY: dev.prodKey };
  t.stampKey = dev.prodKey;
  const r = await runRehearsal(t, { only: ["preflight"] });
  assert.equal(r.green, false);
  const pre = r.steps.find((s) => s.id === "preflight");
  assert.ok(pre.problems.some((p) => /dev would sign with PROD's key/.test(p)), pre.problems.join("; "));
  assert.ok(pre.problems.some((p) => /tools\/stamp-pubkey\.pem is not the public half of dev's STAMP_KEY/.test(p)), pre.problems.join("; "));
});

let crossed = null;

test("one crossing, end to end, through the dev office's doors, the Mists at their last keyframe: green, every step read back from the store", async () => {
  const lines = [];
  // the sandbox step reads CI's verdict for the carried sha; this stand-in hands it one, and
  // test/dev-rehearsal.test.mjs drives the real lookup's every answer
  const sandboxVerdict = async (sha) => ({ runs: 1, status: "completed", conclusion: "success", url: "(the local stand-in's verdict)", head_sha: sha });
  const r = await runRehearsal(target({ sandboxVerdict }), { log: (l) => lines.push(l) });
  const text = renderReport(r);
  // the store's own database: w2_devsandbox_rehearsal, or on a pool tree t<pid>_<n>_w2_devsandbox_rehearsal (POS-479)
  assert.match(dev.store.database, /^(t\d+_\d+_)?w2_devsandbox_rehearsal$/);
  assert.match(lines[0], new RegExp(`^dev-rehearsal: target store ${dev.store.database} \\(the dev office's, from .*\\); not world2_dev$`));
  assert.equal(r.green, true, text);
  const ran = r.steps.filter((s) => !s.pending).map((s) => s.id);
  assert.deepEqual(ran, ["preflight", "sign-in", "join", "resident", "letters", "crossing", "claim", "clearing", "settle", "bless", "clearing-rerun", "by-hand", "refused-alone", "stamp-sandbox"], text);
  assert.deepEqual(r.steps.filter((s) => s.pending).map((s) => s.id), [], "no step is pending (POS-356 landed in #427)");
  // the ground the preflight found, inside the box the wall leaves at every keyframe (POS-595): the
  // box derived from the stand-in's own blessed skeleton, never a literal that a ruled move of the
  // border or the schedule would turn red (Wright's review of #494)
  const { mistsAt } = await import(pathToFileURL(join(dev.world, "tools", "world-engine.mjs")).href);
  const safe = mistsSafeBox(publishedSkeleton(dev.world).skeleton.mists, mistsAt);
  assert.ok(safe, "the stand-in's world carries the Mists");
  const where = `inside the Mists' safe box x ${safe.box.minX}..${safe.box.maxX}, y ${safe.box.minY}..${safe.box.maxY} (clear at keyframes ${safe.keyframes.join(", ")}, inset ${safe.insetM} m)`;
  const ground = r.steps.find((s) => s.id === "preflight").notes.find((n) => n.startsWith("ground: "));
  assert.match(ground ?? "", /^ground: the parcels at \(-?\d+, -?\d+\) and \(-?\d+, -?\d+\), /, text);
  assert.ok(ground.includes(`, ${where}, place `), `${ground}\n  wanted: ${where}`);
  crossed = r;
}, { timeout: 30 * 60_000 });

test("the store names the rehearsal's own standing parcels as covered ground, by the clearing's OVERLAP (POS-595)", async (t) => {
  if (!crossed?.green) return t.skip("the end-to-end run above did not go green");
  const s = await storeClients(target());
  try {
    const [row] = await s.q("clearing_job", "SELECT slug, geometry FROM marks WHERE kind = 'parcel' AND status = 'standing' AND slug = $1", [`rh-${crossed.run}-a/rh-${crossed.run}-ground`]);
    assert.ok(row, "the rehearsal's parcel stands in the store");
    const taken = groundTakenIn(s, OVERLAP, boxOf);
    const own = /^the standing (parcel|sited) "rh-[0-9a-z]+-[ab]\/rh-[0-9a-z]+-(ground|by-hand|lamp)"$/;
    // the place it stands on: covered by it, the lamp on it, or the by-hand parcel beside it (one answer, LIMIT 1)
    assert.match((await taken(groundOf(row.geometry.at, 25))) ?? "", own);
    // a parcel's width east, sharing only an edge: still covered (the operator is inclusive)
    assert.match((await taken(groundOf({ x: row.geometry.at.x + 25, y: row.geometry.at.y }, 25))) ?? "", own);
    assert.equal(await taken(groundOf({ x: row.geometry.at.x + 26, y: row.geometry.at.y }, 25)), null);

    // A STANDING MARK THAT IS NOT A PARCEL covers ground too (Wright's review of #494): the clearing
    // would take a parcel over it, the search does not. The rehearsal's own lamp, copied 60 m east
    // onto open ground (the store's owner writes it, as the clearing's materialize would), covers a
    // place no parcel does, and is named by its kind.
    const lamp = `rh-${crossed.run}-a/rh-${crossed.run}-lamp`;
    const east = `${lamp}-east`;
    const o = await dev.store.connect("world2_owner");
    try {
      const cols = (await o.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marks' AND is_generated = 'NEVER' ORDER BY ordinal_position")).rows.map((c) => c.column_name);
      const pick = cols.map((c) => c === "id" ? "gen_random_uuid()" : c === "slug" ? "$2::text"
        : c === "geometry" ? "jsonb_set(geometry, '{at,x}', to_jsonb((geometry #>> '{at,x}')::numeric + 60))"
        : c === "bbox" ? "bbox + point(60, 0)" : `"${c}"`);
      const put = await o.query(`INSERT INTO marks (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${pick.join(", ")} FROM marks WHERE slug = $1 AND status = 'standing' RETURNING kind`, [lamp, east]);
      assert.equal(put.rows.length, 1, `the rehearsal's lamp ${lamp} stands in the store, to copy`);
      assert.notEqual(put.rows[0].kind, "parcel");
      assert.equal(await taken(groundOf({ x: row.geometry.at.x + 60, y: row.geometry.at.y }, 25)), `the standing ${put.rows[0].kind} "${east}"`);
    } finally {
      await o.query("DELETE FROM marks WHERE slug = $1", [east]).catch(() => {});
      await o.end();
    }
  } finally { await s.end(); }
});
