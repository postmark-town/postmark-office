// spark-names-event-door.test.mjs — POS-1204: a Spark may name its event through the COMMON mark door (leaveMarkViaOffice, the
// World's own spark pre-check included): a known event is enough, an ENDED one too; a name that is no event is refused with a
// reason before anything is written; and a lookup that FAILS is never read as "no such event".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PLAIN_REASONS } from "../src/fault-words.mjs";

const store = await startStore({ db: "pos1204_door" });
const skip = store.skip ?? false;
const ROOT = join(import.meta.dirname, "..");
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

// POS-1234 (WLD-197): THIS TEST NEVER TOUCHES THE SUITE'S SHARED, PINNED WORLD CLONE. The real leave executor seats a draft slot (wt-N) in
// the world clone and runs `git fetch --prune origin` there (world-branches.mjs § seatDraftCheckout). Against the shard's shared clone that
// (1) pulled the newer settlement tags into a clone the suite pins, so the blessed engine moved ahead of the checkout other tests read, and
// (2) contended for `.git/worktrees/wt-0/index.lock` with whatever else held that slot. So the door runs on a PRIVATE clone of it, with no
// origin to fetch from, made before anything imports the clone's path (world-store.mjs reads WORLD_CLONE once, at import).
const SHARED = saved.WORLD_CLONE || join(ROOT, "world-clone");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const sharedState = () => `${git(SHARED, "for-each-ref", "--format=%(refname) %(objectname)")}\n${git(SHARED, "worktree", "list", "--porcelain")}`;
const SHARED_BEFORE = sharedState();
const PRIVATE_DIR = mkdtempSync(join(tmpdir(), "pos1234-world-"));
const PRIVATE = join(PRIVATE_DIR, "world-clone");
execFileSync("git", ["clone", "-q", "--local", "--no-checkout", SHARED, PRIVATE]);
// the shared clone's `main` is its REMOTE-tracking ref (the pin); the private one holds it as its own local main, then drops the remote
git(PRIVATE, "fetch", "-q", "--no-tags", "origin", "+refs/remotes/origin/main:refs/heads/main");
git(PRIVATE, "remote", "remove", "origin");
process.env.WORLD_CLONE = PRIVATE;
const { __setPoolForTest } = await import("../src/world2-pen.mjs");

let pool, owner;
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  __setPoolForTest(null); if (pool) await pool.end(); if (owner) await owner.end(); await store.stop();
  rmSync(PRIVATE_DIR, { recursive: true, force: true });
});

const SHA = "d".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property", key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [prop("spark", "makers", true, "constitution"), cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("spark", { extends: "sited" }),
  ...["recounting", "experienced_at", "event", "rooms", "circle", "circle_path"].map((n) => prop("spark", n, null, "sovereign"))];
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
const spark = (event, over = {}) => ({ slug: "pic", kind: "sited", class: "spark", at: { x: 5, y: 5 }, extent: { w: 120, h: 120 }, body: "a picture", preview: true,
  properties: { recounting: "r", experienced_at: "2026-11-14T20:00:00.000Z", ...(event === undefined ? {} : { event }) }, ...over });

async function setup() {
  pool = new (await import("pg")).default.Pool({ connectionString: store.url("office_api") });
  owner = await store.connect("world2_owner");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1", WORLD_CLONE: PRIVATE });
  __setPoolForTest(pool);
  const { reloadLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  await owner.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open') ON CONFLICT DO NOTHING");
  const ev = (id, state, endsAgoDays) => owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'host', 'host-house', NULL, 0, 0, now() - make_interval(days => $3 + 1), now() - make_interval(days => $3), $4, jsonb_build_object('doors_open', to_char(now() - make_interval(days => $3 + 1), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 0, 1, 1)`, [id, `the ${id}`, endsAgoDays, state]);
  await ev("host/long-over", "announced", 40);
  await ev("host/called-off", "cancelled", 3);
}
const written = async () => (await owner.query(`SELECT (SELECT count(*) FROM acts) a, (SELECT count(*) FROM claims) c, (SELECT count(*) FROM marks) m`)).rows[0];

test("a Spark naming an event: a KNOWN one — ended too — passes the common door; one that is no event is refused with its reason, in preview and live, before anything is written", { skip }, async () => {
  await setup();
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const before = await written();
  const ended = await leaveMarkViaOffice(process.env.WORLD_CLONE, spark("host/long-over"), KEY);
  assert.ok(ended, "an ENDED event is a known event: the common door admits the Spark (preview, nothing written)");
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark("host/called-off"), KEY), "a cancelled event is known too");
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark(undefined), KEY), "no event named: as before, no event needed");
  for (const preview of [true, false]) {
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark("host/never-was", { preview }), KEY),
      (e) => e.code === 422 && /properties\.event "host\/never-was" names no event/.test(e.defect) && /an event that has ended is fine/.test(e.hint) && /nothing was written/.test(e.hint), `preview=${preview}`);
  }
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark("Host/Long-Over"), KEY), (e) => e.code === 422 && /names no event/.test(e.defect), "the id is matched exactly");
  assert.deepEqual(await written(), before, "nothing was written by any of these");
});

test("a lookup that FAILS is a 503 'could not be checked', never 'names no event'", { skip }, async () => {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  await owner.query("ALTER TABLE posts RENAME TO posts_away");
  try {
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark("host/long-over"), KEY),
      (e) => e.code === 503 && /could not be checked/.test(e.defect) && !/names no event/.test(e.defect) && /nothing was written/.test(e.hint)
        // the safe record-read reason (fault-words § PLAIN_REASONS.record), never the store's own text; the raw error goes to the log
        && e.hint.includes(`(${PLAIN_REASONS.record})`) && !/relation|posts|does not exist|sql/i.test(`${e.defect} ${e.hint}`));
  } finally { await owner.query("ALTER TABLE posts_away RENAME TO posts"); }
});

test("POS-1234: the door ran on its PRIVATE clone — the suite's shared pinned world clone has no new ref, tag or draft slot", { skip }, () => {
  assert.notEqual(process.env.WORLD_CLONE, SHARED, "the door was pointed at the private clone");
  assert.equal(sharedState(), SHARED_BEFORE, "the shared clone's refs and worktrees are exactly as the door found them");
});
