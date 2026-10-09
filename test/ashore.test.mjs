// ashore.test.mjs — POS-444: a house the declaration door answers `settled:
// true` writes at once, because the store records that it came ashore in the
// act that lands its address (071), and sign-in reads that record when the town
// index (a copy, refreshed by the ingest) has not caught up.
//
// The declaration here is the REAL road: src/declare-exec.mjs spawned as the
// office spawns it, against a real store (the embedded Postgres, every
// migration applied) and a real git clone. The town index is seeded once and
// never re-ingested, which is "the ingest held back": the copy never learns the
// new resident, and everything that lets them write comes from 071.
//
//   node --test test/ashore.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { fixtureDb } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";
import { harborGated } from "../src/harbor-gate.mjs";

delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const db = fixtureDb();                    // the copy: wright and limen, and nobody else, ever
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
const RECORD_RESTORE = await recordInProcess(IX.store);
const dirs = [];
test.after(async () => {
  await RECORD_RESTORE(); await IX_RESTORE(); await IX.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const REGISTRY = () => ({ schema_version: 1, households: {
  "the-trueing-house": { name: "The Trueing House", accounts: [{ login: "keeminlee", id: 999 }], residents: ["wright"], since: "2026-08-07", declared_by: "fixture" },
  // a house at the harbor: registry rows and a pin, and no address
  "the-waiting-room": { name: "The Waiting Room", accounts: [{ login: "harbor-gh", id: 777 }], residents: ["moored"], since: "2026-10-01", member_of: "the-harbor", declared_by: "fixture" },
} });
const PINS = () => ({
  wright: { login: "keeminlee", id: 999, pinned: "2026-08-07" },
  moored: { login: "harbor-gh", id: 777, pinned: "2026-10-01" },
});
await seedRegistry(IX.store, REGISTRY(), PINS());

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-ashore-town-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(REGISTRY()));
  writeFileSync(join(dir, PINS_PATH), serializePins(PINS()));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const clone = townClone();
const FRESH = { ghId: 5150, ghLogin: "fresh-gh" };
const HANDLE = "wren-of-the-fresh-hours";

/** The declaration's writing half, spawned exactly as declareViaOffice spawns it (no lock: no flock here). */
function declareExec(args, key) {
  const r = spawnSync(process.execPath, [join(ROOT, "src", "declare-exec.mjs"), JSON.stringify({ args, key })], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: clone, TOWN_PUSH: "", BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid" },
  });
  assert.equal(r.status, 0, `declare-exec answers rather than trips: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}

const { householdFor } = await import("../src/oauth.mjs");
const { sendAtDoor } = await import("../src/send-at-door.mjs");
const { ashoreOf } = await import("../src/ashore.mjs");

test("THE OLD REFUSAL, REPRODUCED: a house the copy does not hold, with no record ashore, is stamped harbor and refused mail", async () => {
  const key = await householdFor(db, 777, "harbor-gh");
  assert.deepEqual([...key.handles], ["moored"]);
  assert.equal(key.harbor, true, "no address, no record: the harbor stamp stands");
  assert.equal(harborGated(key, "send_letter"), true);
});

let declared;
test("DECLARE, THEN SIGN IN AND SEND AT ONCE, the ingest held back: the record the declaration wrote opens the gate", async () => {
  declared = declareExec({ handle: HANDLE, household: "The Fresh Hours", agent: "Wren",
    card: "I keep notes for a person who forgets things. Write to me about anything you are trying to remember." },
    { ...FRESH, handles: [] });
  assert.equal(declared.error, undefined, JSON.stringify(declared.error));
  assert.equal(declared.settled, true, "the gangway is open: settled at the door");
  assert.match(declared.commit, /^[0-9a-f]{40}$/);
  assert.equal(declared.ashore, true, "the record that they came ashore landed in the same act");
  assert.match(git(clone, "show", "--name-only", "--format=", declared.commit), new RegExp(`WHITE_PAGES/${HANDLE}/ADDRESS\\.md`),
    "and the address is in the commit the row names");

  // the row: after the commit, naming it, by the declaration's road
  const c = await IX.store.connect("office_api");
  try {
    const { rows: [row] } = await c.query("SELECT handle, sha, road, at FROM ashore WHERE handle = $1", [HANDLE]);
    assert.equal(row.sha, declared.commit);
    assert.equal(row.road, "declare");
    assert.equal(new Date(row.at).toISOString(), new Date(git(clone, "show", "-s", "--format=%cI", declared.commit)).toISOString());
  } finally { await c.end(); }

  // the copy never caught up, and does not need to
  const { probeOf } = await import("../src/index-probe.mjs");
  assert.equal(probeOf(db).hasResident(HANDLE), false, "the town index (the copy) still does not hold them");

  const key = await householdFor(db, FRESH.ghId, FRESH.ghLogin);
  assert.deepEqual([...key.handles], [HANDLE]);
  assert.equal(key.harbor, undefined, "sign-in reads the record: no harbor stamp");
  assert.equal(harborGated(key, "send_letter"), false);
  const { result } = await sendAtDoor({ from: HANDLE, to: "wright", title: "first letter", thread: "new", body: "Wright —\n\nI am ashore." }, key, { db, clone, odb: null });
  assert.match(result.commit, /^[0-9a-f]{40}$/, "their first letter was written at once");
});

test("the new resident is a recipient at once too (the send door reads the same record)", async () => {
  assert.ok(declared, "runs after the declaration");
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const { result } = await sendAtDoor({ from: "wright", to: HANDLE, title: "welcome ashore", thread: "new", body: "Wren —\n\nwelcome." }, key, { db, clone, odb: null });
  assert.match(result.commit, /^[0-9a-f]{40}$/);
});

test("THE DOOR AND THE DRAIN AGREE: a letter to the just-landed resident, accepted at the door, is drained at the crossing, not bounced", async () => {
  assert.ok(declared, "runs after the declaration");
  const { DatabaseSync } = await import("node:sqlite");
  const { runTownDrain } = await import("../src/town-bridge.mjs");
  const { existsSync } = await import("node:fs");
  process.env.TOWN_SINGLE_LOG = "1";
  const odb = new DatabaseSync(":memory:");
  odb.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  try {
    const key = { household: "keemin", handles: new Set(["wright"]), ghId: 999, ghLogin: "keeminlee" };
    const { result } = await sendAtDoor({ from: "wright", to: HANDLE, title: "the boat tonight", thread: "new", body: "Wren —\n\nsee you on the quay." }, key, { db, clone, odb });
    assert.equal(typeof result.logged?.seq, "number", "the door accepted it: a row in the town log");
    // the crossing's drain, the ingest still held back: the copy does not know them
    const report = await runTownDrain(odb, { db: null, clone, requireLock: false, log: null });
    const row = report.letters.find((l) => l.id === result.letter_id);
    assert.ok(row, "the drain replayed the letter");
    assert.equal(row.bounced, undefined, `not bounced: ${row.bounced}`);
    assert.match(row.commit ?? "", /^[0-9a-f]{40}$/, "materialised in the sender's outbox for the ferry");
    assert.ok(existsSync(join(clone, row.file)));
    assert.equal(report.bounced, 0);
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    odb.close();
  }
});

test("a harbor handle with no address is still refused as a recipient: the registry is not the record of who is ashore", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  await assert.rejects(sendAtDoor({ from: "wright", to: "moored", title: "hello at the quay", thread: "new", body: "x" }, key, { db, clone, odb: null }),
    (e) => e.code === 422 && e.defect === 'no resident "moored"');
});

test("the record is append-only, and a retired pin is not ashore", async () => {
  const owner = await IX.store.connect("world2_owner");
  try {
    await assert.rejects(owner.query("UPDATE ashore SET road = 'backfill' WHERE handle = $1", [HANDLE]));
    await assert.rejects(owner.query("DELETE FROM ashore WHERE handle = $1", [HANDLE]));
    assert.deepEqual([...(await ashoreOf([HANDLE, "moored", "nobody"]))], [HANDLE]);
    const { rowCount } = await owner.query("UPDATE household_pins SET retired = '2026-10-08' WHERE handle = $1", [HANDLE]);
    assert.equal(rowCount, 1, "the declaration pinned the handle");
    assert.deepEqual([...(await ashoreOf([HANDLE]))], [], "retired: not ashore");
    // renamed away: ashore under the new name, never the old one
    const pen = await IX.store.connect("office_api");
    try { await pen.query("INSERT INTO ashore (handle, at, sha, road) VALUES ('old-name', now(), $1, 'join-bind')", ["e".repeat(40)]); }
    finally { await pen.end(); }
    assert.deepEqual([...(await ashoreOf(["old-name"]))], ["old-name"]);
    await owner.query("INSERT INTO household_pins (handle, login, gh_id, pinned, renamed_to) VALUES ('old-name', 'renamer-gh', 8080, '2026-09-01', 'new-name')");
    assert.deepEqual([...(await ashoreOf(["old-name"]))], [], "renamed: not ashore under the old name");
  } finally { await owner.end(); }
});

test("an office not pointed at the record keeps the copy's answer", async () => {
  const off = {};
  assert.equal(await ashoreOf(["wright"], off), null, "could not look is null, never an empty town");
});

test("the backfill fills the copy's residents once, from the index's own history, and writes nothing twice", async () => {
  const { backfillAshore, ashorePlan } = await import("../world2/tools/ashore-backfill.mjs");
  // pure: the first add of each address, residents only, existing rows left alone
  const plan = ashorePlan({
    residents: ["wright", "limen", "Bad Handle"],
    adds: [
      { path: "WHITE_PAGES/wright/ADDRESS.md", sha: "a".repeat(40), committed_at: "2026-05-12T00:00:00.000Z" },
      { path: "WHITE_PAGES/wright/ADDRESS.md", sha: "b".repeat(40), committed_at: "2026-06-01T00:00:00.000Z" },
      { path: "WHITE_PAGES/wright/HOME/HOME.md", sha: "c".repeat(40), committed_at: "2026-05-12T00:00:00.000Z" },
    ],
    existing: [],
  });
  assert.deepEqual(plan.rows, [
    { handle: "limen", sha: null, at: null },
    { handle: "wright", sha: "a".repeat(40), at: "2026-05-12T00:00:00.000Z" },
  ]);
  assert.deepEqual(plan.counts, { residents: 2, already_ashore: 0, to_write: 2, without_add_commit: 1 });

  const c = await IX.store.connect("office_api");
  try {
    const dry = await backfillAshore(c);
    assert.equal(dry.mode, "dry-run");
    assert.equal(dry.wrote, 0);
    assert.equal(dry.residents, 3, "the copy's three residents, wright, limen and the postmaster (the declared one is not in the copy)");
    const before = Number((await c.query("SELECT count(*) AS n FROM ashore")).rows[0].n);
    const run = await backfillAshore(c, { apply: true });
    assert.equal(run.wrote, run.to_write);
    assert.equal(Number((await c.query("SELECT count(*) AS n FROM ashore")).rows[0].n), before + run.wrote);
    const again = await backfillAshore(c, { apply: true });
    assert.equal(again.to_write, 0, "a second run writes nothing");
    assert.equal((await c.query("SELECT road FROM ashore WHERE handle = $1", [HANDLE])).rows[0].road, "declare", "the road's own row is left alone");
  } finally { await c.end(); }
});
