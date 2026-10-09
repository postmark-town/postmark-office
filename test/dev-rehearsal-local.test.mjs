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
// HEAVY: minutes (a hydrate, a crossing, a clearing, two settlements with the
// world's checker suite). It runs through `node G:/Postmark/pool/run-heavy.mjs`.
// A store that cannot start FAILS with the reason (embedded-store.mjs § NO_STORE).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { localDevTarget } from "./helpers/dev-target.mjs";
import { PROD_DB, runRehearsal, renderReport, targetFromFiles } from "../tools/dev-rehearsal.mjs";

let dev;
before(async () => { dev = await localDevTarget(); }, { timeout: 20 * 60_000 });
after(async () => { await dev?.stop(); });

const target = (extra = {}) => ({ ...targetFromFiles({ envFile: dev.envFile, rolesFile: dev.rolesFile, office: dev.officeBase, prodStampKey: dev.prodKey }), ...extra });

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
  t.env = { ...t.env, TOWN_INDEX_READS: undefined, STAMP_KEY: undefined };
  const r = await runRehearsal(t, { only: ["preflight"] });
  assert.equal(r.green, false);
  const pre = r.steps.find((s) => s.id === "preflight");
  assert.ok(pre.problems.some((p) => /without TOWN_INDEX_READS=store/.test(p)), pre.problems.join("; "));
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
  assert.ok(pre.problems.some((p) => /is PROD's key/.test(p)), pre.problems.join("; "));
  assert.ok(pre.problems.some((p) => /tools\/stamp-pubkey\.pem is not the public half of dev's STAMP_KEY/.test(p)), pre.problems.join("; "));
});

test("one crossing, end to end, through the dev office's doors: green, every step read back from the store", async () => {
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
}, { timeout: 30 * 60_000 });
