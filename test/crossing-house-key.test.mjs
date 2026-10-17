// crossing-house-key.test.mjs — a crossing never leaves a house on two keys for a day, even when an earlier join into it stalls (POS-600).
//
//   node --test --test-concurrency=1 test/crossing-house-key.test.mjs
//
// THE HAZARD. A crossing plans every join's `registry:` key lines at once, and
// a house's housemate re-keys were filed under the FIRST planned join into that
// house. When that join's store write stalled and a later join into the same
// house landed, the writer kept only the landed rows' lines: the housemates
// stayed on their human's gh: key while the new joiner was hh:<house>. The
// town's deriveMints caps per day per household key, so on that date the house
// earned under two caps. The fix re-plans from the joins that LANDED, with the
// entry key snapshot, and re-runs the whole judgment before any clone write.
//
// WHAT RUNS. The real planTownDrain / writeTownDrain / runTownDrain, the real
// house-key judgment (the town's own predicate, pen and replay, through the
// clone's engine), and — as the dated oracle — the town's OWN deriveMints over
// the ledger this crossing wrote. The town's CODE comes from the suite's pinned
// town clone (test/clone-pins.json, STAMP_ENGINE_DIR); every input is a fixed
// literal in a temp dir: the rooms, pins, houses, a two-line sealed ledger
// signed with a key GENERATED here, and synthetic deliveries. No real ledger,
// registry, letter or key. The record is the suite's in-memory pool seeded from
// the temp clone (test/registry-pool-stub.mjs), with a store failure injected
// for one handle.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { appendTownJournal, ensureTownJournal, townDrainCursor, pendingRows } from "../src/town-journal.mjs";
import * as drain from "../src/town-drain.mjs"; // a namespace, so this file still loads over the train's writer (the baseline run)
const { planTownDrain, writeTownDrain } = drain;
import { runTownDrain } from "../src/town-bridge.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const TOWN = townClone();
const HAS_PREDICATE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const ENGINE = HAS_PREDICATE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_PREDICATE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const SKIP = !TOWN ? NO_TOWN : (!HAS_PREDICATE && "the town clone predates tools/household-keys.mjs");

const D = "2026-10-04";
const D1 = "2026-10-05";
const scratch = tempDir("postmark-pos600-");
let seq = 0;

// ── the synthetic town ──────────────────────────────────────────────────────
// The porch: two residents on their human's gh:12345 key, both with rooms.
const PORCH = () => ({
  houses: { porch: { name: "Porch", accounts: [{ login: "porch-gh", id: 12345 }], residents: ["alpha", "beta"] } },
  pins: { alpha: { id: 12345 }, beta: { id: 12345 } },
  rooms: ["alpha", "beta"],
});
function sealedTown({ houses, pins, rooms }) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = join(scratch, `town-${++seq}`);
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: houses }, null, 2) + "\n");
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify(pins));
  for (const h of rooms) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  const lines = ["- 2026-06-12 · rules: stamps-v1"];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(dir, "stamp-key.pem");
  writeFileSync(keyFile, pem);
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t.invalid", ...a], { stdio: "pipe" });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "seed");
  return { dir, keyFile };
}
const ledgerOf = (dir) => readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8");
/** The registry lines after the seed, without their signatures. */
const keyLines = (dir) => ledgerOf(dir).split("\n").filter((l) => / · registry: /.test(l)).map((l) => l.replace(/ · sig: \S+$/, ""));
const line = (date, h) => `- ${date} · registry: ${h} = hh:porch`;

const odb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  ensureTownJournal(db);
  return db;
};
const joinRow = (handle, over = {}) => ({
  cls: "join", act: "declare-household", household: "porch", handle,
  ghId: "12345", ghLogin: "porch-gh", payload: { household: "Porch", card: `${handle}'s card` }, ...over,
});

/**
 * The record for one call: the pool seeded from the clone, with `failing`
 * deciding which writes throw. "before" refuses firstjoin's MEMBERSHIP write
 * (nothing of theirs lands); "partial" lets the membership land and refuses
 * their PIN (joinHousehold writes the house row, then the pin).
 */
async function withRecord(dir, failing, fn) {
  const seeded = poolFromClone(dir);
  const pool = {
    ...seeded,
    async query(text, params) {
      const mine = JSON.stringify(params ?? []).includes('"firstjoin"');
      if (failing === "before" && mine && /INSERT INTO households\b/i.test(text)) throw new Error("permission denied for table households");
      if (failing === "partial" && mine && /INSERT INTO household_pins\b/i.test(text)) throw new Error("permission denied for table household_pins");
      if (failing === "both" && /INSERT INTO households\b/i.test(text)) throw new Error("permission denied for table households");
      if (failing === "middle" && JSON.stringify(params ?? []).includes('"midjoin"') && /INSERT INTO households\b/i.test(text))
        throw new Error("permission denied for table households");
      return seeded.query(text, params);
    },
  };
  const keep = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, RECORD_ON);
  __setPoolForTest(pool);
  try { return await fn(); } finally {
    __setPoolForTest(null);
    if (keep.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.pg;
    if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
  }
}
const withEnv = async (over, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};
const engineEnv = (town) => ({ STAMP_KEY: town.keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools") });

/** The writer alone (the bare caller: no entry snapshot handed over). */
async function crossOnce(town, db, { date, failing = null, judge } = {}) {
  return withEnv(engineEnv(town), () => withRecord(town.dir, failing, async () => {
    const plan = await planTownDrain(db, town.dir, { date });
    return writeTownDrain(town.dir, plan, { date, ...(judge ? { judge } : {}) });
  }));
}

// ── the dated oracle: the town's own deriveMints ────────────────────────────
// Synthetic deliveries on D: each house member sends to (and hears from) 30
// distinct correspondents, more than any daily cap. The control is the same
// load from ONE handle: what one key's cap mints. A house on one key mints
// exactly the control; a house split across two keys mints more.
function mintsOn(dir, date, members) {
  assert.equal(typeof ENGINE.deriveMints, "function", "the town engine exports deriveMints");
  const { laws, revisions } = ENGINE.parseLaws(ENGINE.parseStampLedger(ledgerOf(dir)));
  const households = ENGINE.householdKeys(dir);
  const deliveries = [];
  for (const h of members) for (let i = 0; i < 30; i++) {
    deliveries.push({ id: `${h}-out-${i}`, date, from: h, to: `corr-out-${h}-${i}` });
    deliveries.push({ id: `${h}-in-${i}`, date, from: `corr-in-${h}-${i}`, to: h });
  }
  const mints = ENGINE.deriveMints(deliveries, households, { laws, revisions });
  const of = (side) => mints.filter((m) => m.date === date && m.side === side && members.includes(m.handle)).length;
  return { sent: of("sent"), received: of("received") };
}
const oneKeyCap = (dir, date) => mintsOn(dir, date, ["alpha"]);

// ═══ the hazard: the first join into the house stalls, the second lands ═════

for (const failing of ["before", "partial"]) {
  test(`STALL (${failing}): the housemates are re-keyed with the landed join, all on D, and the house mints under ONE cap that day`, { skip: SKIP }, async () => {
    const town = sealedTown(PORCH());
    const db = odb();
    await appendTownJournal(db, joinRow("firstjoin"));
    await appendTownJournal(db, joinRow("latejoin"));
    const prefix = ledgerOf(town.dir);

    const touched = await crossOnce(town, db, { date: D, failing });
    assert.deepEqual((touched.stalled ?? []).map(({ row }) => row.handle), ["firstjoin"], "the first join stalled at the store");
    assert.equal(touched.keyHeld, undefined, "nothing was held by the key judgment");
    // FIRST, the economic invariant, through the town's own dated cap: one key's cap on D, both sides
    const house = mintsOn(town.dir, D, ["alpha", "beta", "latejoin"]);
    const one = oneKeyCap(town.dir, D);
    assert.ok(one.sent > 0 && one.sent < 30, `the control is a real cap (${one.sent})`);
    assert.deepEqual(house, one, "the whole house mints under ONE cap on D (a split house would mint two caps' worth)");
    assert.deepEqual(new Set(keyLines(town.dir)), new Set([line(D, "latejoin"), line(D, "alpha"), line(D, "beta")]),
      "the landed join carries every housemate's re-key, all dated D; the stalled joiner has none");
    assert.ok(ledgerOf(town.dir).startsWith(prefix.trimEnd()), "the prior ledger bytes are unchanged");
    assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], [], "the appended batch's seals verify over the ledger as it stands");
    assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "firstjoin", "ADDRESS.md")), false, "no card for the stalled joiner");

    // RETRY at D+1: the held row lands with only its own line; D is not regrouped
    const before = ledgerOf(town.dir);
    const again = await crossOnce(town, db, { date: D1 });
    assert.equal((again.stalled ?? []).length, 0);
    assert.ok(ledgerOf(town.dir).startsWith(before.trimEnd()), "D's lines and seals are untouched");
    assert.deepEqual(keyLines(town.dir).filter((l) => l.startsWith(`- ${D1} `)), [line(D1, "firstjoin")], "the retry adds the owed join only");
    assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
    assert.deepEqual(mintsOn(town.dir, D, ["alpha", "beta", "latejoin"]), one, "D's caps are as they were");
    assert.deepEqual(mintsOn(town.dir, D1, ["alpha", "beta", "latejoin", "firstjoin"]), oneKeyCap(town.dir, D1), "and D+1 is one cap with the newcomer");
  });
}

test("ALL LAND: the first join carries the housemates, as before", { skip: SKIP }, async () => {
  const town = sealedTown(PORCH());
  const db = odb();
  await appendTownJournal(db, joinRow("firstjoin"));
  await appendTownJournal(db, joinRow("latejoin"));
  await crossOnce(town, db, { date: D });
  assert.deepEqual(keyLines(town.dir), [line(D, "firstjoin"), line(D, "alpha"), line(D, "beta"), line(D, "latejoin")]);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
});

test("ALL STALL: nothing is appended and no card is written", { skip: SKIP }, async () => {
  const town = sealedTown(PORCH());
  const db = odb();
  await appendTownJournal(db, joinRow("firstjoin"));
  await appendTownJournal(db, joinRow("latejoin"));
  const prefix = ledgerOf(town.dir);
  const touched = await crossOnce(town, db, { date: D, failing: "both" });
  assert.equal(touched.stalled.length, 2);
  assert.equal(ledgerOf(town.dir), prefix, "the ledger is byte-identical");
  assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "latejoin")), false);
});

test("DIFFERENT HOUSES: a stall in one house leaves the other's re-keys whole", { skip: SKIP }, async () => {
  const town = sealedTown({
    houses: { ...PORCH().houses, yard: { name: "Yard", accounts: [{ login: "yard-gh", id: 777 }], residents: ["gamma"] } },
    pins: { ...PORCH().pins, gamma: { id: 777 } },
    rooms: ["alpha", "beta", "gamma"],
  });
  const db = odb();
  await appendTownJournal(db, joinRow("firstjoin"));
  await appendTownJournal(db, joinRow("yardjoin", { household: "yard", ghId: "777", ghLogin: "yard-gh", payload: { household: "Yard", card: "y" } }));
  const touched = await crossOnce(town, db, { date: D, failing: "before" });
  assert.deepEqual(touched.stalled.map(({ row }) => row.handle), ["firstjoin"]);
  assert.deepEqual(keyLines(town.dir), [`- ${D} · registry: yardjoin = hh:yard`, `- ${D} · registry: gamma = hh:yard`]);
});

// ═══ POS-339: a stall in the MIDDLE of the crossing, then the town's verifier ═
//
// Every signature binds the whole prefix before it (the seal chain), so a batch
// signed over the whole plan and appended without a stalled row's lines leaves
// every later line's signature over lines that are not there. Until #3429
// (10-05) the drain did exactly that: it signed the plan once, before the store
// loop, and appended the landed rows' lines by seq. Prod ran it from
// release/2026-w41 to w41.2, and the reproduction below red there with
// "line 4: SIGNATURE FAILS" at lastjoin's line. POS-600's second decision signs
// only the batch that landed; this holds it.
// THE CAN-FAIL FLIP: in writeTownDrain, append the preflight's whole-plan
// signatures filtered by the landed seqs in place of `approved`; this reds with
// SIGNATURE FAILS on the first line after the stalled join's.

test("POS-339: three joins, the middle stalls at the store; the lines that land verify, and only theirs are written", { skip: SKIP }, async () => {
  const town = sealedTown({
    houses: {
      ...PORCH().houses,
      yard: { name: "Yard", accounts: [{ login: "yard-gh", id: 777 }], residents: ["gamma"] },
      cedar: { name: "Cedar", accounts: [{ login: "cedar-gh", id: 888 }], residents: ["delta"] },
    },
    pins: { ...PORCH().pins, gamma: { id: 777 }, delta: { id: 888 } },
    rooms: ["alpha", "beta", "gamma", "delta"],
  });
  const db = odb();
  await appendTownJournal(db, joinRow("firstjoin"));
  await appendTownJournal(db, joinRow("midjoin", { household: "yard", ghId: "777", ghLogin: "yard-gh", payload: { household: "Yard", card: "m" } }));
  await appendTownJournal(db, joinRow("lastjoin", { household: "cedar", ghId: "888", ghLogin: "cedar-gh", payload: { household: "Cedar", card: "l" } }));
  const prefix = ledgerOf(town.dir);

  const touched = await crossOnce(town, db, { date: D, failing: "middle" });
  assert.deepEqual((touched.stalled ?? []).map(({ row }) => row.handle), ["midjoin"], "the middle join stalled at the store");
  assert.equal(touched.keyHeld, undefined, "nothing was held by the key judgment");
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], [],
    "every appended line's signature verifies over the ledger as it stands, the lines after the stall included");
  assert.deepEqual(keyLines(town.dir), [
    line(D, "firstjoin"), line(D, "alpha"), line(D, "beta"),
    `- ${D} · registry: lastjoin = hh:cedar`, `- ${D} · registry: delta = hh:cedar`,
  ], "the first and last joins' lines, in order; none for the stalled join or its house");
  assert.ok(ledgerOf(town.dir).startsWith(prefix.trimEnd()), "the prior ledger bytes are unchanged");
  assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "midjoin", "ADDRESS.md")), false, "no card for the stalled joiner");

  // the next crossing lands the held row, and the whole ledger still verifies
  const again = await crossOnce(town, db, { date: D1 });
  assert.equal((again.stalled ?? []).length, 0);
  assert.deepEqual(keyLines(town.dir).filter((l) => l.startsWith(`- ${D1} `)),
    [`- ${D1} · registry: midjoin = hh:yard`, `- ${D1} · registry: gamma = hh:yard`], "the retry writes the held join's lines");
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
});

// ═══ the second decision refuses or throws: EVERY landed join is held ═══════

for (const [name, judge] of [
  ["refuses", () => ({ signed: [], refusal: { code: 409, field: "household", defect: "an injected refusal" }, detail: "never shown" })],
  ["throws", () => { throw new Error("an injected trip"); }],
]) {
  test(`SECOND JUDGMENT ${name}: through the bridge, every landed join is held — no card, line or register; still pending; the cursor holds`, { skip: SKIP }, async () => {
    const town = sealedTown(PORCH());
    const db = odb();
    await appendTownJournal(db, joinRow("firstjoin"));
    await appendTownJournal(db, joinRow("latejoin"));
    const ledger = ledgerOf(town.dir);
    const registry = readFileSync(join(town.dir, REGISTRY_PATH), "utf8");
    const report = await withEnv({ ...engineEnv(town), TOWN_SINGLE_LOG: "1" }, () => withRecord(town.dir, "before", () =>
      runTownDrain(db, { db, clone: town.dir, lockHeld: () => true, log: () => {}, date: D, storeJudge: judge })));
    assert.equal(report.ran, true, JSON.stringify(report).slice(0, 300));
    assert.deepEqual(report.settled, [], "nothing is reported settled");
    const why = Object.fromEntries((report.store ?? []).map((r) => [r.handle, r.why]));
    assert.match(why.firstjoin, /could not write the town's record/, "the stalled row keeps its own reason");
    assert.match(why.latejoin, /house-key judgment, re-run after the town's record was written/, "the held row names the post-store judgment");
    assert.match(why.latejoin, /the record may already hold its membership and pin/);
    assert.doesNotMatch(why.latejoin, /never shown|hh:|gh:/, "no predicate detail and no key is leaked");
    assert.equal(ledgerOf(town.dir), ledger, "no key line");
    assert.equal(readFileSync(join(town.dir, REGISTRY_PATH), "utf8"), registry, "no printed register");
    assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "latejoin")), false, "no card");
    assert.equal(await townDrainCursor(db), 0, "the cursor did not move");
    assert.deepEqual((await pendingRows(db)).map((r) => r.handle).sort(), ["firstjoin", "latejoin"], "both rows are still pending");
  });
}

test("THROUGH THE BRIDGE, a stall: the landed join settles with the housemates' re-keys; the stalled one is reported pending, not settled", { skip: SKIP }, async () => {
  const town = sealedTown(PORCH());
  const db = odb();
  await appendTownJournal(db, joinRow("firstjoin"));
  await appendTownJournal(db, joinRow("latejoin"));
  const report = await withEnv({ ...engineEnv(town), TOWN_SINGLE_LOG: "1" }, () => withRecord(town.dir, "before", () =>
    runTownDrain(db, { db, clone: town.dir, lockHeld: () => true, log: () => {}, date: D })));
  assert.deepEqual(report.settled, ["latejoin"]);
  assert.deepEqual((report.store ?? []).map((r) => r.handle), ["firstjoin"]);
  assert.deepEqual(new Set(keyLines(town.dir)), new Set([line(D, "latejoin"), line(D, "alpha"), line(D, "beta")]));
  assert.equal(await townDrainCursor(db), 0, "a stalled row holds the cursor, as before");
  assert.deepEqual(mintsOn(town.dir, D, ["alpha", "beta", "latejoin"]), oneKeyCap(town.dir, D));
});

// ═══ the judgment's registry: a resident is not removed for a stalled row ═══

test("landedRegistry keeps a resident whose own queued row stalled, drops only new joiners that stalled, and a stalled row's new house", () => {
  const entry = { households: { porch: { name: "Porch", residents: ["alpha", "gamma"] } } };
  const final = { households: {
    porch: { name: "Porch", residents: ["alpha", "gamma", "firstjoin", "latejoin"] },
    attic: { name: "Attic", residents: ["newbie"] },
  } };
  const row = (handle, household) => ({ row: { handle, household }, plan: { slug: household } });
  const out = drain.landedRegistry({ registry: final, entryRegistry: entry },
    [row("latejoin", "porch")], [row("gamma", "porch"), row("firstjoin", "porch"), row("newbie", "attic")]);
  assert.deepEqual(out.households.porch.residents, ["alpha", "gamma", "latejoin"]);
  assert.equal(out.households.attic, undefined, "a house only a stalled row founded is not judged");
  // without an entry snapshot (a bare plan), only the stalled handles leave
  const bare = drain.landedRegistry({ registry: final }, [row("latejoin", "porch")], [row("firstjoin", "porch")]);
  assert.deepEqual(bare.households.porch.residents, ["alpha", "gamma", "latejoin"]);
  assert.match(drain.KEY_JUDGEMENT_HELD("refused (x)"), /^this crossing's house-key judgment, re-run after/);
});
