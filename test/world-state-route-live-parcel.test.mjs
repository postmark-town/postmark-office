// world-state-route-live-parcel.test.mjs — POS-686: GET /world/state at a real office, with an own-parcel amendment and withdrawal owed in its store.
//
//   node --test test/world-state-route-live-parcel.test.mjs
//
// A spawned office on a real store holding the owed rows (the acts and the pending claim an amend and a withdraw write), no settlement sealed, so the
// route serves the published file (`meta.source: "file"`, W2_FOLD unset): the pinned clone's real canon. What a caller sees at the door: an own-parcel
// mark's new body and a withdrawn own-parcel mark gone, for anonymous callers; a real market mark that was edited and withdrawn in the same store is
// served as canon (Darko: common-ground market marks stay settled); nothing else about the answer moves. Removing the route's call into the layer
// turns the first two legs red.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = join(ROOT, "world-clone");
let tmp, ix;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-world-state-live-parcel-"));
  ix = await indexStore(fixtureTown(), { db: "world_state_live_parcel" });
});
after(async () => {
  await ix?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function withOffice(fn) {
  const env = { ...process.env, ...ix.env, OFFICE_READ_WORKERS: "0", WORLD_CLONE: WORLD, TOWN_CLONE: join(ROOT, "town-clone") };
  delete env.W2_FOLD;
  const proc = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const logs = { out: "", err: "", exit: null };
  proc.stdout.on("data", (d) => { logs.out += String(d); });
  proc.stderr.on("data", (d) => { logs.err += String(d); });
  const gone = new Promise((ok) => proc.on("exit", (code, signal) => { logs.exit = { code, signal }; ok(); }));
  try {
    for (let i = 0; i < 300 && !logs.out.includes("listening") && !logs.exit; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(logs.out.includes("listening"), `the office never listened: ${JSON.stringify(logs.exit)} ${logs.err.slice(-400)}`);
    await fn(`http://127.0.0.1:${logs.out.match(/listening on :(\d+)/)[1]}`, logs);
  } finally { proc.kill(); await gone; }
}
const state = async (base) => { const r = await fetch(`${base}/world/state`); assert.equal(r.status, 200); return r.json(); };

const owner = async (fn) => { const c = await ix.store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
async function owe(rows) {
  await owner(async (c) => {
    await c.query("TRUNCATE claims, windows, acts RESTART IDENTITY CASCADE");
    await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (320, '2026-11-18T00:00:00Z', '2026-11-18T12:00:00Z', 'closed'), (321, '2026-11-18T12:00:00Z', '2026-11-19T00:00:00Z', 'open')");
    for (const r of rows) {
      await c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, $1, $2, $3, 'mark')", [r.by, r.action, r.id]);
      if (r.body != null) await c.query("INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug) VALUES (321, 'sited', $1, $2, 'pending', $3, '{}', 0, '{}', $4)", [r.by, `solo:${r.by}`, r.body, r.id]);
    }
  });
}

test("the route serves the owed own-parcel edits and nothing else: new body, withdrawn mark gone, a market mark settled", async () => {
  const canon = JSON.parse(readFileSync(join(WORLD, "WORLD", "world-state.json"), "utf8")).marks;
  const homes = canon.filter((m) => m.tier === "home" && m.kind !== "parcel" && typeof m.body === "string");
  const [amended, withdrawn] = homes;
  const market = canon.find((m) => m.tier === "market" && m.kind !== "parcel" && typeof m.body === "string");
  assert.ok(amended && withdrawn && market);
  await withOffice(async (base, logs) => {
    await owe([]);
    const before = await state(base);
    assert.equal(before.meta?.source, "file", JSON.stringify(before.meta) + logs.err.slice(-300));
    assert.equal(before.marks.find((m) => m.id === amended.id).body, amended.body);

    await owe([
      { by: amended.by, action: "amend", id: amended.id, body: "AN AMENDMENT THE CROSSING HAS NOT CARRIED" },
      { by: withdrawn.by, action: "withdraw", id: withdrawn.id },
      { by: market.by, action: "amend", id: market.id, body: "SYNTHETIC LIVE BODY ON COMMON GROUND" },
      { by: market.by, action: "withdraw", id: market.id },
    ]);
    const after = await state(base);
    assert.equal(after.marks.find((m) => m.id === amended.id).body, "AN AMENDMENT THE CROSSING HAS NOT CARRIED", "the own-parcel amendment is served");
    assert.ok(!after.marks.some((m) => m.id === withdrawn.id), "the own-parcel withdrawal is served");
    assert.equal(after.marks.find((m) => m.id === market.id)?.body, market.body, "a market mark stays canon's, edited and withdrawn in the store or not");
    assert.equal(after.marks.length, before.marks.length - 1, "one mark gone, no other");
    const others = (s) => JSON.stringify(s.marks.filter((m) => m.id !== amended.id && m.id !== withdrawn.id));
    assert.equal(others(after), others({ marks: before.marks.filter((m) => m.id !== withdrawn.id) }), "every other mark, byte for byte");

    // the store stops owing it (the claim retracted, the author re-leaves): the route is canon's again, with no deploy and no wait
    await owner((c) => c.query("UPDATE claims SET status = 'retracted'"));
    await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, $1, 'leave-mark', $2, 'mark')", [withdrawn.by, withdrawn.id]));
    await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, $1, 'leave-mark', $2, 'mark')", [amended.by, amended.id]));
    const back = await state(base);
    assert.equal(back.marks.find((m) => m.id === amended.id).body, amended.body);
    assert.ok(back.marks.some((m) => m.id === withdrawn.id));
  });
});
