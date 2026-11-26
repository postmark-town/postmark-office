// move-housemate.test.mjs — a resident leaves a household that KEEPS its other residents; the source stays (POS-1162).
//
// Darko, POS-448/a (2026-11-21 14:10Z: "Yes"): five meeps move to the town's household, "their past acts staying
// recorded as Starforge's" and only new acts the town's. Wright: "Bring the dry run's output here before any real
// move." Wright, settled on POS-1162: "POS-1162 stays membership-only", the dry run lists each meep's credential
// impact without secrets, and a real move waits, per meep, for POS-448's own credential.
//
// Every house, handle, login, id, key hash and mark here is INVENTED. The store is a real embedded Postgres with every
// migration applied; the clone holds the town's own engine over a ledger signed with a key this test holds.
// The shape is move-resident.test.mjs's, because the road is the same road; what differs is that the source STAYS.
//
//   H1   the dry run names every store row (before and after), file line, the exact ledger line and where it lands,
//        what does not carry, the credential impact; and reaches no writer
//   H1b  the command's --dry-run; a real run takes no default credential precondition
//   H2   every refusal, by name, before any write, dry run and real
//   H2b  the key is judged first (planHouseKey); no stamp may move; an unreadable fold is unavailable, never "unchanged"
//   H3   THE MOVE: only `residents` changes on the two rows; the source row stays; every carried field's falsifier;
//        history, pins and balances unchanged; one commit; the ledger line lands where the dry run said and replays green
//   H3b  a target housemate still off the house key gets its line in the same act, and the dry run names it
//   H4   only the owner writes
//   H5   RESUMABLE: no duplicate publication, from the store and the sealed ledger, through another drain, and refused
//        by name on a shallow clone or with no evidence
//   H6   the transaction re-reads under its lock and rolls back, also from a failure after its first write
//   H7   unavailable counts and credential facts say so; no secret is ever read or printed
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/move-housemate.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pinTown, stageTownTools } from "./helpers/pinned-town.mjs";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { execFileSync } from "node:child_process";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { loadRegistryRows, moveHousemateInStore, MOVE_ROW_REFUSALS } from "../src/registry-store.mjs";
import { renderPublicRegistry } from "../src/registry-rows.mjs";
import { notLandedError, penTransaction, penCommit } from "../src/write.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { moveHousemate, planHousemate, describe, main, lineDiff, HOUSEMATE_REFUSALS } from "../tools/move-housemate.mjs";
import { historyCounts, credentialImpact } from "../src/housemate-evidence.mjs";

const TOWN = townClone();
const HAS_ENGINE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const SKIP = !TOWN ? NO_TOWN : (!HAS_ENGINE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");
const ENGINE = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const KEYS = HAS_ENGINE ? await import(townModuleUrl("tools", "household-keys.mjs")) : null;

delete process.env.TOWN_PUSH;
const D = "2026-11-10";

const IX = await indexStore(fixtureTown());
const RECORD_RESTORE = await recordInProcess(IX.store);
after(async () => { await RECORD_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// THE TOWN: `keepers` keeps four residents and wears an old key and an account; `harbor` is the house they move to;
// `zeds` is next door. `mover` is the one who moves. Source-owned things the move must leave alone: a home picture
// for each of two residents, an invitation credit, an account, a former key.
const HOUSES = () => ({
  keepers: { name: "Keepers", accounts: [{ login: "keep-gh", id: 601 }], residents: ["warden", "clerk", "mover", "scribe"], since: "2026-07-16",
    declared_by: "fixture", formerly: ["old-keepers"], invited_by: { by: "zeds", named: "zed", at: "2026-10-24T12:00:00.000Z" },
    home_images: { mover: "https://media.postmark.town/keepers/mm.png", warden: "https://media.postmark.town/keepers/ww.png" } },
  harbor: { name: "Harbor", accounts: [{ login: "harbor-gh", id: 701 }], residents: ["pilot"], since: "2026-07-16", declared_by: "fixture",
    home_images: { pilot: "https://media.postmark.town/harbor/pp.png" } },
  zeds: { name: "Zeds", accounts: [{ login: "zed-gh", id: 999 }], residents: ["zed"], since: "2026-06-12", declared_by: "fixture" },
});
const PINS = () => ({
  warden: { login: "keep-gh", id: 601, pinned: "2026-07-16" },
  clerk: { login: "keep-gh", id: 601, pinned: "2026-07-16" },
  mover: { login: "keep-gh", id: 601, pinned: "2026-07-16" },
  scribe: { login: "scribe-gh", id: 602, pinned: "2026-07-16" },
  pilot: { login: "harbor-gh", id: 701, pinned: "2026-07-16" },
  zed: { login: "zed-gh", id: 999, pinned: "2026-06-12" },
});
const KEYED = ["- 2026-09-02 · registry: pilot = hh:harbor", "- 2026-10-25 · registry: mover = hh:keepers", "- 2026-10-25 · registry: warden = hh:keepers",
  "- 2026-10-25 · registry: clerk = hh:keepers", "- 2026-10-25 · registry: scribe = hh:keepers"]; // every resident of both houses is on its house key before the move
const CARD_HOUSE = { warden: "Keepers", clerk: "Keepers", mover: "Keepers", scribe: "Keepers", pilot: "Harbor", zed: "Zeds" };

/** The store seeded, and a sealed clone whose printouts are the store's own print. */
async function town({ houses = HOUSES(), pins = PINS(), ledger = KEYED, berth = false } = {}) {
  await seedRegistry(IX.store, { schema_version: 1, note: "invented for POS-1162", households: houses }, pins);
  const printed = renderPublicRegistry(await loadRegistryRows());
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = tempDir("pm-move-housemate-");
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), printed.households);
  writeFileSync(join(dir, PINS_PATH), printed.pins);
  for (const [h, house] of Object.entries(CARD_HOUSE)) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: ${pins[h]?.login ?? "x"}\nhousehold: ${house}\n---\n\n# ${h}\n`);
  }
  if (berth) {
    mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
    writeFileSync(join(dir, "HARBOR", "berths", "mover.md"), "---\nhandle: mover\nhousehold: keepers\n---\n");
  }
  // a delivery to the mover, so the ledger holds stamps for them (the mints the mail earns, derived by the town's engine)
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# mail\n\n- 2026-06-12 · zed-2026-06-12-to-mover-genesis · zed → mover\n");
  const bare = ["- 2026-06-12 · rules: stamps-v1", ...ledger];
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${bare.join("\n")}\n`);
  const { laws, revisions } = ENGINE.parseLaws(ENGINE.parseStampLedger(bare.join("\n") + "\n"));
  const mints = ENGINE.deriveMints(ENGINE.parseDeliveries(dir), ENGINE.householdKeys(dir), { laws, revisions }).map(ENGINE.mintLine);
  const lines = [...bare, ...mints];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyDir = tempDir("pm-move-housemate-pen-");
  dirs.push(keyDir);
  const keyFile = join(keyDir, "stamp-key.pem");
  writeFileSync(keyFile, pem);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return { dir, keyFile };
}

const withPen = async (t, fn) => {
  const over = { STAMP_KEY: t.keyFile, TOWN_PINS_DIR: pinTown(stageTownTools(t.dir, TOWN)) };
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

const ownerQuery = async (sql, params = []) => { const c = await IX.store.connect("world2_owner"); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } };
const asOwner = () => IX.store.connect("world2_owner");
/** Every household column the move could touch (and a few it must not), and the pins. */
async function storeRows() {
  const h = await ownerQuery("SELECT slug, ord, name, residents, accounts, formerly, home_images, since, to_jsonb(households) -> 'invited_by' AS invited_by, to_jsonb(households) -> 'likeness' AS likeness FROM households ORDER BY slug");
  const p = await ownerQuery("SELECT handle, login, gh_id::text AS gh_id, pinned FROM household_pins ORDER BY handle");
  return { households: h, pins: p };
}
const ledgerOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const registryLines = (dir) => ledgerOf(dir).split("\n").filter((l) => / · registry: /.test(l)).map((l) => l.replace(/ · sig: \S+$/, ""));
const head = (dir) => git(dir, "rev-parse", "HEAD");
const clean = (dir) => git(dir, "status", "--porcelain") === "";

// A writer that must never be reached.
const NEVER = (what) => async () => { throw new Error(`the dry run reached ${what}`); };
const NO_WRITERS = { owner: NEVER("the owner's connection"), move: NEVER("the store transaction"),
  drainWith: () => { throw new Error("the dry run reached the drain"); }, commit: () => { throw new Error("the dry run reached the pen"); } };
const READY = "POS-448 receipt: mover's own town key (synthetic)";
const ARGS = { handle: "mover", from: "keepers", to: "harbor" };

// ── the history a mover leaves behind (SYNTHETIC) ───────────────────────────
async function seedHistory() {
  const c = await asOwner();
  try {
    await c.query("DELETE FROM letter_notes; DELETE FROM resident_notes; DELETE FROM letter_opens; DELETE FROM oauth_tokens WHERE token_hash LIKE 'synthetic-hash-%'");
    // THE PUBLIC RECORD IS NEVER DELETED (the store refuses it: acts are append-only, a docket claim is retracted not deleted), so acts, claims
    // and marks are written once for the whole file; the private tables and the key rows are re-seeded for every test.
    const [{ n }] = (await c.query("SELECT (SELECT count(*) FROM acts WHERE actor = 'mover')::int + (SELECT count(*) FROM claims WHERE claimant = 'mover')::int AS n")).rows;
    if (n === 0) {
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (9901, now(), now(), 'closed') ON CONFLICT (id) DO NOTHING");
      for (const [actor, house] of [["mover", "hh:keepers"], ["mover", "hh:keepers"], ["mover", "gh:601"], ["mover", "hh:harbor"], ["warden", "hh:keepers"]])
        await c.query("INSERT INTO acts (at, actor, action, class, household) VALUES (now(), $1, 'say', 'say', $2)", [actor, house]);
      for (const house of ["hh:keepers", "hh:keepers", "hh:old-keepers"])
        await c.query("INSERT INTO claims (window_id, class, claimant, household, status) VALUES (9901, 'mark', 'mover', $1, 'pending')", [house]);
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, locked_window)
        VALUES (gen_random_uuid(), 'mover/yard', 'parcel', 'mover', 'hh:keepers', '{}', box(point(8000,8000), point(8010,8010)), 9901)`);
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, locked_window)
        VALUES (gen_random_uuid(), 'mover/lamp', 'sited', 'mover', 'gh:601', '{}', box(point(8100,8100), point(8101,8101)), 9901)`);
    }
    for (const [letter, house] of [["l1", "hh:keepers"], ["l2", "gh:601"], ["l3", "hh:harbor"]])
      await c.query("INSERT INTO letter_opens (handle, letter, household, opened_at, how) VALUES ('mover', $1, $2, now(), 'read')", [letter, house]);
    await c.query("INSERT INTO resident_notes (handle, household, body, written_at) VALUES ('mover', 'hh:keepers', 'SYNTHETIC-NOTE-BODY-5c1d', now())");
    await c.query("INSERT INTO letter_notes (household, letter, state, waiting_on, marked_at, marked_by) VALUES ('hh:keepers', 'l1', 'no-reply', NULL, now(), 'mover')");
    // key rows: the hashes are invented and never printed; one names the mover under the source, one under the target
    await c.query(`INSERT INTO oauth_tokens (token_hash, kind, gh_id, created, household, handles) VALUES
      ('synthetic-hash-a', 'static', NULL, 1, 'keepers', '["mover","warden"]'),
      ('synthetic-hash-b', 'static', NULL, 1, 'harbor', '["pilot"]'),
      ('synthetic-hash-c', 'static', NULL, 1, 'harbor', '["mover"]')`);
    await c.query(`INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, created, expires) VALUES
      ('synthetic-hash-d', 'access', 601, 'keep-gh', 1, extract(epoch FROM now())::bigint + 3600),
      ('synthetic-hash-e', 'access', 601, 'keep-gh', 1, 5)`);
  } finally { await c.end(); }
}
/** The history rows' counts, whole: the move must leave every one of them where it was. */
const historyRows = () => ownerQuery(`SELECT 'acts' AS t, actor || '|' || coalesce(household, '-') AS k, count(*)::int AS n FROM acts GROUP BY 1, 2
  UNION ALL SELECT 'claims', claimant || '|' || coalesce(household, '-'), count(*)::int FROM claims GROUP BY 1, 2
  UNION ALL SELECT 'marks', slug || '|' || household || '|' || owner, count(*)::int FROM marks GROUP BY 1, 2
  UNION ALL SELECT 'letter_opens', handle || '|' || household, count(*)::int FROM letter_opens GROUP BY 1, 2
  UNION ALL SELECT 'resident_notes', handle || '|' || household, count(*)::int FROM resident_notes GROUP BY 1, 2
  UNION ALL SELECT 'letter_notes', marked_by || '|' || household, count(*)::int FROM letter_notes GROUP BY 1, 2 ORDER BY 1, 2`);

const dry = (t, over = {}) => withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, dryRun: true, ...NO_WRITERS, ...over }));

// ── H1 the dry run ──────────────────────────────────────────────────────────

test("H1 · the dry run names every row, file line and ledger line, what does not carry and the credential impact, and reaches no writer", { skip: SKIP }, async (tc) => {
  await seedHistory();
  const t = await town({ berth: true });
  const before = await storeRows();
  const hist = await historyRows();
  const h0 = head(t.dir);
  const out = await dry(t);
  assert.equal(out.dryRun, true);
  const { plan, evidence } = out;
  assert.equal(plan.from, "keepers");
  assert.equal(plan.resuming, false);
  assert.deepEqual(plan.pin, { handle: "mover", untouched: true });

  // 1. the two store rows, before and after: only `residents` moves, and the source row is kept
  assert.deepEqual(plan.store.source.before.residents, ["warden", "clerk", "mover", "scribe"]);
  assert.deepEqual(plan.store.source.after.residents, ["warden", "clerk", "scribe"]);
  assert.deepEqual(plan.store.target.before.residents, ["pilot"]);
  assert.deepEqual(plan.store.target.after.residents, ["pilot", "mover"]);
  for (const k of ["source", "target"]) for (const f of ["accounts", "formerly", "home_images", "invited_by"])
    assert.deepEqual(plan.store[k].after[f], plan.store[k].before[f], `${k}.${f} is shown unchanged`);
  assert.deepEqual(plan.store.target.after.formerly, [], "nothing goes into the target's formerly");
  assert.deepEqual(plan.store.target.after.accounts, [701], "and it gains none of the source's accounts");
  assert.deepEqual(plan.store.target.after.home_images, ["pilot"], "or the mover's home picture");

  // 2. the town files: the registry's exact lines, the card, the berth
  assert.deepEqual(plan.registry.source.after.residents, ["warden", "clerk", "scribe"]);
  assert.deepEqual(plan.registry.target.after.residents, ["pilot", "mover"]);
  assert.ok(plan.registry.diff.lines.length > 0 && plan.registry.diff.lines.every((l) => /^[-+]/.test(l)), "exact + and - lines");
  assert.ok(plan.registry.diff.lines.some((l) => l.startsWith("-") && /mover/.test(l)) && plan.registry.diff.lines.some((l) => l.startsWith("+") && /mover/.test(l)));
  assert.deepEqual(plan.registry.home_picture_printed, { before: true, after: false }, "the printed file stops showing the mover's picture: a consequence the dry run states, not one the move hides");
  assert.deepEqual(plan.cards.map((c) => [c.path, c.before, c.after]), [
    ["WHITE_PAGES/mover/ADDRESS.md", "Keepers", "Harbor"],
    ["HARBOR/berths/mover.md", "keepers", "Harbor"],
  ]);

  // 3. THE LEDGER LINE: exact, dated, and where it lands (computed independently here, from the file)
  assert.deepEqual(plan.ledger.lines.map((l) => l.line), [`- ${D} · registry: mover = hh:harbor`]);
  assert.equal(plan.ledger.checked, "quiet");
  const text = ledgerOf(t.dir).replace(/\s*$/, "").split("\n");
  assert.deepEqual(plan.ledger.landing, { file: "WHITE_PAGES/stamp-ledger.md", after_entry: text.filter((l) => /^- \d{4}-\d{2}-\d{2} · /.test(l)).length,
    tail_dated: "2026-10-25", first_line: text.length + 1, last_line: text.length + 1 });

  // 4. WHAT DOES NOT CARRY: the history counts, by table and spelling, from the SOURCE's spelling set
  const H = evidence.history;
  assert.deepEqual(H.spelling_set.slice(0, 3), ["hh:keepers", "hh:old-keepers", "gh:601"], "the live key, its former key, its account");
  assert.ok(H.spelling_set.slice(3).every((k) => /^solo:/.test(k)), "then the solo spellings its residents wore (household-deriver.mjs § houseKeysOf)");
  assert.deepEqual(H.tables.acts, { scope: "public", in_source_set: 3, by_spelling: { "hh:keepers": 2, "gh:601": 1 }, outside_source_set: 1 }, "acts: warden's act is not the mover's; the hh:harbor act is not the source's");
  assert.deepEqual(H.tables.claims.by_spelling, { "hh:keepers": 2, "hh:old-keepers": 1 });
  assert.equal(H.tables.claims.in_source_set, 3);
  assert.deepEqual(H.tables.marks.by_kind, { parcel: 1, sited: 1 });
  assert.equal(H.tables.marks.in_source_set, 2);
  assert.deepEqual(H.tables["letters (letter_opens)"].by_spelling, { "hh:keepers": 1, "gh:601": 1 }, "the hh:harbor open is invisible through the source's set, and is not counted as the source's");
  assert.equal(H.tables["letters (letter_opens)"].outside_source_set, null, "a private table does not claim to count outside its set");
  assert.deepEqual(H.tables["notes (resident_notes)"].by_spelling, { "hh:keepers": 1 });
  assert.deepEqual(H.tables["notes (letter_notes)"].by_spelling, { "hh:keepers": 1 });
  assert.equal(H.ground.count, 2);
  assert.deepEqual(H.ground.slugs, ["sited:mover/lamp (standing)", "parcel:mover/yard (standing)"]);
  assert.match(plan.stays_with_source.home_picture, /^set/);
  assert.match(plan.stays_with_source.invite_credit, /the source carries one/);
  // balance and stake, unchanged, and a control that the fold sees stamps at all
  assert.equal(plan.stamps.unchanged, true);
  assert.ok(plan.stamps.balance.before > 0, "control: the town's fold sees the mover's stamps");
  assert.deepEqual(plan.stamps.balance, { before: plan.stamps.balance.before, after: plan.stamps.balance.before });
  assert.deepEqual(plan.stamps.staked, { before: 0, after: 0 });

  // 5. the credential impact, from non-secret metadata
  const C = evidence.credentials;
  assert.deepEqual(C.sign_in, { pinned_account: { login: "keep-gh", id: 601 }, listed_in_source: true, listed_in_target: false });
  assert.deepEqual(C.static_keys, { count: 2, keys: [
    { household: "harbor", bound_to_source: false, bound_to_target: true },
    { household: "keepers", bound_to_source: true, bound_to_target: false }] });
  assert.deepEqual(C.live_sign_in_keys, { by_kind: { access: 1 } }, "the expired access key is not live");
  assert.equal(C.bound_to_source, true);
  assert.match(C.harness_keys.unavailable, /not in the store/);

  // NOTHING WRITTEN: the store, the history, the clone, its HEAD, its ledger
  assert.deepEqual(await storeRows(), before);
  assert.deepEqual(await historyRows(), hist);
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir), "no file in the clone changed");

  const printed = describe(plan, { dryRun: true, evidence });
  for (const line of printed.split("\n")) tc.diagnostic(`dry-run | ${line}`);
  for (const s of ["DRY RUN — nothing written.", "from: keepers (stays)", "pin: household_pins mover — unchanged",
    'residents   ["warden","clerk","mover","scribe"] -> ["warden","clerk","scribe"]', 'residents   ["pilot"] -> ["pilot","mover"]', "(unchanged)",
    "nothing goes into harbor's formerly", "NOTE: mover's home picture is printed today and is NOT printed after the move", "WHITE_PAGES/mover/ADDRESS.md: household: Keepers -> Harbor", "HARBOR/berths/mover.md: household: keepers -> Harbor",
    `- ${D} · registry: mover = hh:harbor · sig: <the office pen>`, `lands after entry ${plan.ledger.landing.after_entry}`,
    "acts: 3 spelled in the source's set (gh:601 1, hh:keepers 2)", "spelled outside the source's set: 1",
    "static keys naming mover: 2", "bound to keepers: true", "harness keys: UNAVAILABLE", "--credential-ready"])
    assert.ok(printed.includes(s), `the dry run says: ${s}\n${printed}`);
  assert.doesNotMatch(printed, /synthetic-hash|SYNTHETIC-NOTE-BODY/, "no key hash and no note body is ever printed");
});

test("H1b · the command's --dry-run prints the plan and writes nothing; arguments are required; a real run takes no default credential precondition", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const log = [], err = [];
  const code = await withPen(t, () => main(["--handle", "mover", "--from", "keepers", "--to", "harbor", "--dry-run"],
    { env: { ...process.env, TOWN_CLONE: t.dir }, log: (s) => log.push(s), err: (s) => err.push(s), act: (a) => moveHousemate({ ...a, date: D, ...NO_WRITERS }) }));
  assert.equal(code, 0, err.join("\n"));
  assert.match(log.join("\n"), /^DRY RUN — nothing written\./);
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
  assert.equal(await main(["--handle", "mover", "--to", "harbor"], { err: () => {} }), 2, "all three arguments are required");

  // A REAL MOVE WITHOUT THE RECEIPT refuses by name, after the plan and before any write, and nothing is half-done
  for (const credentialReady of [undefined, null, "", "  ", "two\nlines"])
    await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady, ...NO_WRITERS })),
      (e) => e.defect === HOUSEMATE_REFUSALS.CREDENTIAL_PRECONDITION.defect, `receipt ${JSON.stringify(credentialReady)}`);
  const err2 = [];
  assert.equal(await withPen(t, () => main(["--handle", "mover", "--from", "keepers", "--to", "harbor"],
    { env: { ...process.env, TOWN_CLONE: t.dir }, log: () => {}, err: (s) => err2.push(s), act: (a) => moveHousemate({ ...a, date: D, ...NO_WRITERS }) })), 1);
  assert.match(err2.join("\n"), /REFUSED — a real move names the receipt/);
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

// ── H2 the refusals ─────────────────────────────────────────────────────────

test("H2 · every refusal is named and writes nothing, in a dry run and a real one", { skip: SKIP }, async () => {
  const cases = [
    ["the handle has no pin", {}, { handle: "ghost" }, HOUSEMATE_REFUSALS.NO_PIN],
    ["no household at --from", {}, { from: "no-such-house" }, HOUSEMATE_REFUSALS.NO_SOURCE],
    ["--from is only a former key", {}, { from: "old-keepers" }, HOUSEMATE_REFUSALS.NO_SOURCE],
    ["no household at --to", {}, { to: "no-such-house" }, HOUSEMATE_REFUSALS.NO_TARGET],
    ["the target is the source", {}, { to: "keepers" }, HOUSEMATE_REFUSALS.TARGET_IS_SOURCE],
    ["the handle is not in the named source", {}, { from: "zeds" }, HOUSEMATE_REFUSALS.NOT_IN_SOURCE],
    ["the move would leave the source empty", { houses: (() => { const h = HOUSES(); h.keepers.residents = ["mover"]; return h; })() }, {}, HOUSEMATE_REFUSALS.WOULD_EMPTY],
    ["the handle already lives in the target and the ledger keys them there", {}, { handle: "pilot", from: "keepers" }, HOUSEMATE_REFUSALS.SAME_HOUSE],
    ["the handle lives in the target and nothing shows they were moved there", { ledger: [KEYED[1]] }, { handle: "pilot", from: "keepers" }, HOUSEMATE_REFUSALS.NO_MOVE_EVIDENCE],
    ["the handle is listed in both houses", { houses: (() => { const h = HOUSES(); h.harbor.residents = ["pilot", "mover"]; return h; })() }, {}, HOUSEMATE_REFUSALS.IN_BOTH_HOUSES],
    ["the ledger keys the handle's stamps to a third house", { ledger: [KEYED[0], "- 2026-10-25 · registry: mover = hh:zeds"] }, {}, HOUSEMATE_REFUSALS.KEY_ELSEWHERE],
  ];
  for (const [why, shape, over, refusal] of cases) {
    const t = await town(shape);
    const before = await storeRows();
    const h0 = head(t.dir);
    const lines = registryLines(t.dir);
    for (const dryRun of [true, false])
      await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, ...over, clone: t.dir, date: D, dryRun, credentialReady: READY, ...NO_WRITERS })),
        (e) => e.code === refusal.code && e.defect === refusal.defect, `${why} (dryRun ${dryRun})`);
    assert.deepEqual(await storeRows(), before, `${why}: the store is untouched`);
    assert.equal(head(t.dir), h0);
    assert.ok(clean(t.dir), `${why}: the clone is untouched`);
    assert.deepEqual(registryLines(t.dir), lines, `${why}: no line signed`);
  }
});

test("H2a · a printout behind the store for ANOTHER house refuses (the collateral rule): the move never carries a change unasked", { skip: SKIP }, async () => {
  const t = await town();
  await ownerQuery("UPDATE households SET name = 'Zeds Renamed' WHERE slug = 'zeds'");
  const before = await storeRows();
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.COLLATERAL.defect && e.detail === "zeds");
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

test("H2b · the key is judged first, and no stamp may move", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  // the real planHouseKey: the ledger's tail is after the date
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: "2026-10-01", credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.HOUSE_KEY.defect && /ledger's newest line is dated ahead/.test(e.detail));
  // the dating rule's TODAY refusal, as planHouseKey reports it
  const today = { refusal: { defect: "this house's residents have already earned stamps today" }, detail: "mover already has stamps on 2026-11-10" };
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, keyPlan: () => today, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.HOUSE_KEY.defect && /already has stamps/.test(e.detail));
  // a fold that moves: the town's folds over the planned lines differ from the ledger as it stands
  const moves = async () => ({ handle: "mover", balance: { before: 5, after: 4 }, staked: { before: 0, after: 0 }, unchanged: false });
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, stamps: moves, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.STAMPS_MOVE.defect && /balance 5 -> 4/.test(e.detail));
  // an unreadable fold is UNAVAILABLE in a dry run, never "unchanged"; a real run refuses it
  const blind = async () => ({ unavailable: "the pinned engine could not be read" });
  const out = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, dryRun: true, stamps: blind, ...NO_WRITERS }));
  assert.equal(out.plan.stamps.unchanged, undefined);
  const text = describe(out.plan, { dryRun: true, evidence: out.evidence });
  assert.match(text, /balance and stake: UNAVAILABLE — the pinned engine could not be read/);
  assert.doesNotMatch(text, /unchanged by the planned lines/);
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, stamps: blind, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.STAMPS_UNREADABLE.defect);
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

// ── H3 the move ─────────────────────────────────────────────────────────────

test("H3 · THE MOVE: only `residents` changes on two rows, the source stays whole, history and pins and balances are as they were; one commit, green", { skip: SKIP }, async () => {
  await seedHistory();
  const t = await town({ berth: true });
  const before = await storeRows();
  const hist = await historyRows();
  const h0 = head(t.dir);
  const balances = (dir) => [...ENGINE.foldBalances(ENGINE.parseStampLedger(ledgerOf(dir))).entries()].sort();
  const stakedBefore = [...ENGINE.foldStaked(ENGINE.parseStampLedger(ledgerOf(t.dir))).entries()].sort();
  const balBefore = balances(t.dir);
  const planned = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  const out = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, owner: asOwner, credentialReady: READY }));
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(t.dir, "rev-parse", `${out.commit}^`), h0, "one commit");
  assert.match(git(t.dir, "log", "-1", "--format=%B", out.commit), /moves from keepers to harbor · keepers stays — the pin and past acts unchanged .*POS-1162; credential: POS-448 receipt/);

  const s = await storeRows();
  // EVERY CARRIED FIELD'S FALSIFIER: each of these goes red if the move inherits movedTargetRow or the source DELETE
  assert.deepEqual(s.pins, before.pins, "THE PIN IS KEPT: every pin, the mover's included");
  assert.deepEqual(s.households.map((h) => h.slug), ["harbor", "keepers", "zeds"], "no house is retired or created");
  const keepers = s.households.find((h) => h.slug === "keepers");
  const was = before.households.find((h) => h.slug === "keepers");
  assert.deepEqual(keepers.residents, ["warden", "clerk", "scribe"], "the mover left; the source keeps its remaining residents, in order");
  assert.deepEqual({ ...keepers, residents: null }, { ...was, residents: null }, "the source row is whole: name, ord, accounts, formerly, home pictures, invitation credit, likeness, since");
  assert.deepEqual(keepers.home_images, was.home_images, "the source keeps the mover's home picture");
  assert.deepEqual(keepers.invited_by, was.invited_by, "the source keeps its invitation credit");
  assert.deepEqual(keepers.formerly, ["old-keepers"]);
  const harbor = s.households.find((h) => h.slug === "harbor");
  const harborWas = before.households.find((h) => h.slug === "harbor");
  assert.deepEqual(harbor.residents, ["pilot", "mover"]);
  assert.deepEqual({ ...harbor, residents: null }, { ...harborWas, residents: null }, "the target row gains nothing but the resident: no formerly entry, no account, no home picture");
  assert.deepEqual(harbor.formerly, []);
  assert.deepEqual(harbor.accounts, [{ login: "harbor-gh", id: 701 }]);
  assert.deepEqual(s.households.find((h) => h.slug === "zeds"), before.households.find((h) => h.slug === "zeds"), "the house next door is untouched");
  assert.deepEqual(await historyRows(), hist, "HISTORY KEEPS ITS SPELLING: not one row of acts, claims, marks, letters or notes changed");
  assert.deepEqual(balances(t.dir), balBefore, "every balance is as it was");
  assert.deepEqual([...ENGINE.foldStaked(ENGINE.parseStampLedger(ledgerOf(t.dir))).entries()].sort(), stakedBefore, "and every stake");

  // the commit: the printed registry, the card, the berth, the ledger, and nothing else
  assert.deepEqual(git(t.dir, "show", "--name-only", "--format=", out.commit).split("\n").filter(Boolean).sort(),
    [REGISTRY_PATH, "WHITE_PAGES/mover/ADDRESS.md", "HARBOR/berths/mover.md", "WHITE_PAGES/stamp-ledger.md"].sort());
  const printed = JSON.parse(readFileSync(join(t.dir, REGISTRY_PATH), "utf8")).households;
  assert.deepEqual(printed.keepers.residents, ["warden", "clerk", "scribe"], "the source is still printed");
  assert.deepEqual(printed.harbor.residents, ["pilot", "mover"]);
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md"), "utf8"), /^household: Harbor$/m);
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md"), "utf8"), /^handle: mover$/m, "the handle stays");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "clerk", "ADDRESS.md"), "utf8"), /^household: Keepers$/m, "the source's other residents' cards are not touched");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: mover = hh:harbor`], "one signed key line, appended");
  // THE LEDGER LINE LANDS WHERE THE DRY RUN SAID, and replays through stamp-verify
  const physical = ledgerOf(t.dir).replace(/\s*$/, "").split("\n");
  assert.equal(physical[planned.plan.ledger.landing.first_line - 1].replace(/ · sig: \S+$/, ""), `- ${D} · registry: mover = hh:harbor`);
  assert.equal(physical.length, planned.plan.ledger.landing.last_line);
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], [], "the town's stamp-verify reads it green");
  assert.deepEqual(KEYS.describe(KEYS.householdKeySplits({ roll: ENGINE.currentHouseholds(t.dir), houses: printed })), [], "one household, one key");
  assert.equal(ENGINE.currentHouseholds(t.dir).get("mover").key, "hh:harbor", "new acts are the town's");
  assert.equal(ENGINE.currentHouseholds(t.dir).get("warden").key, "hh:keepers", "the source's residents keep the source's key");
  assert.ok(clean(t.dir));
});

test("H3b · a target housemate still off the house key gets its line in the same act, and the dry run names it", { skip: SKIP }, async () => {
  const t = await town({ ledger: [KEYED[1], KEYED[2]] });
  const planned = await dry(t);
  assert.deepEqual(planned.plan.ledger.lines.map((l) => [l.handle, l.line]), [
    ["mover", `- ${D} · registry: mover = hh:harbor`],
    ["pilot", `- ${D} · registry: pilot = hh:harbor`]]);
  assert.match(planned.plan.ledger.lines[1].role, /a housemate of the target/);
  assert.match(describe(planned.plan, { dryRun: true, evidence: planned.evidence }), /registry: pilot = hh:harbor · sig: <the office pen>   \(a housemate of the target/);
  const out = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, owner: asOwner, credentialReady: READY }));
  assert.deepEqual(registryLines(t.dir), [KEYED[1], KEYED[2], `- ${D} · registry: mover = hh:harbor`, `- ${D} · registry: pilot = hh:harbor`]);
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  assert.match(out.commit, /^[0-9a-f]{40}$/);
});

// ── H4 only the owner ───────────────────────────────────────────────────────

test("H4 · only the owner writes the move: as office_api it is refused, and nothing moves or is published", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, owner: () => IX.store.connect("office_api") })),
    (e) => e.defect === MOVE_ROW_REFUSALS.NOT_OWNER.defect && /office_api/.test(e.detail));
  assert.deepEqual(await storeRows(), before);
  assert.equal(head(t.dir), h0);
});

// ── H5 resumable ────────────────────────────────────────────────────────────

const stall = (t, over = {}) => withPen(t, () => penTransaction(t.dir, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, owner: asOwner, credentialReady: READY,
  commit: () => { throw notLandedError("a fixture race"); }, ...over })));
const otherDrainLands = async (dir) => {
  const { drain, paths } = collectingDrain({ clone: dir });
  await drain({ note: "an unrelated ceremony's drain" });
  return penCommit(dir, paths, "registry: an unrelated ceremony's drain (fixture)");
};

test("H5 · RESUMABLE: a push that cannot land leaves the store moved; the same command publishes the rest, once; then nothing is left", { skip: SKIP }, async () => {
  const t = await town({ ledger: [KEYED[1], KEYED[2]] }); // pilot is off the house key too, so a duplicate would show for two handles
  const h0 = head(t.dir);
  await assert.rejects(stall(t), (e) => e.code === 503 && /run the same command again/.test(e.detail));
  const moved = await storeRows();
  assert.deepEqual(moved.households.find((h) => h.slug === "harbor").residents, ["pilot", "mover"], "the store moved");
  assert.equal(moved.households.find((h) => h.slug === "keepers").residents.includes("mover"), false);
  assert.equal(head(t.dir), h0, "the clone did not");
  assert.ok(clean(t.dir), "and holds nothing half-written");

  const again = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.resuming, true);
  assert.equal(again.plan.store, null);
  assert.match(again.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(await storeRows(), moved, "the store did not move again");
  assert.deepEqual(registryLines(t.dir), [KEYED[1], KEYED[2], `- ${D} · registry: mover = hh:harbor`, `- ${D} · registry: pilot = hh:harbor`], "one key line each, never two");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md"), "utf8"), /^household: Harbor$/m);
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);

  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.SAME_HOUSE.defect && /the ledger keys them there/.test(e.detail), "published whole: nothing left to do");
  assert.equal(registryLines(t.dir).length, 4, "no line was written by the refused run");
});

test("H5b · RESUMED FROM THE STORE, THE LEDGER AND THE PRINTOUT'S HISTORY: another ceremony's drain prints the move first, and the rerun still finishes it", { skip: SKIP }, async () => {
  const t = await town({ berth: true });
  await assert.rejects(stall(t), (e) => e.code === 503);
  const moved = await storeRows();
  assert.match(await otherDrainLands(t.dir), /^[0-9a-f]{40}$/, "another ceremony's drain landed in between");
  assert.deepEqual(JSON.parse(readFileSync(join(t.dir, REGISTRY_PATH), "utf8")).households.harbor.residents, ["pilot", "mover"], "the printout already shows the move");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md"), "utf8"), /^household: Keepers$/m, "the card is still unpublished");
  const again = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.resuming, true);
  assert.deepEqual(await storeRows(), moved, "the store did not move again");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md"), "utf8"), /^household: Harbor$/m);
  assert.match(readFileSync(join(t.dir, "HARBOR", "berths", "mover.md"), "utf8"), /^household: Harbor$/m);
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: mover = hh:harbor`], "the signed key line, exactly once");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  assert.ok(clean(t.dir));
});

test("H5c · NO HISTORY, NO GUESS: a shallow clone after another drain refuses by name, writing nothing; the full clone still resumes", { skip: SKIP }, async () => {
  const t = await town({ berth: true });
  await assert.rejects(stall(t), (e) => e.code === 503);
  await otherDrainLands(t.dir);
  const shallowDir = tempDir("pm-move-housemate-shallow-");
  dirs.push(shallowDir);
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${t.dir}`, join(shallowDir, "town")], { encoding: "utf8" });
  const shallow = join(shallowDir, "town");
  const before = await storeRows();
  const h0 = head(shallow);
  const lines = registryLines(shallow);
  for (const dryRun of [true, false])
    await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: shallow, date: D, dryRun, credentialReady: READY, ...NO_WRITERS })),
      (e) => e.defect === HOUSEMATE_REFUSALS.NO_MOVE_EVIDENCE.defect && /a shallow clone may not reach it/.test(e.detail), `dryRun ${dryRun}`);
  assert.deepEqual(registryLines(shallow), lines, "no signed completion");
  assert.equal(head(shallow), h0);
  assert.ok(clean(shallow), "no file written");
  assert.deepEqual(await storeRows(), before);
  const full = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  assert.equal(full.plan.resuming, true, "the full clone, which holds the history, still resumes: the genuine interrupted move is not lost");
});

test("H5d · A RESUMED CARD MUST MATCH: a household line naming neither house refuses, naming the card, before any write", { skip: SKIP }, async () => {
  const t = await town();
  await assert.rejects(stall(t), (e) => e.code === 503);
  const card = join(t.dir, "WHITE_PAGES", "mover", "ADDRESS.md");
  writeFileSync(card, readFileSync(card, "utf8").replace("household: Keepers", "household: Our Little Cottage"));
  git(t.dir, "commit", "-qam", "mover's own words");
  const before = await storeRows();
  const lines = registryLines(t.dir);
  await assert.rejects(withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, credentialReady: READY, ...NO_WRITERS })),
    (e) => e.defect === HOUSEMATE_REFUSALS.CARD_UNMATCHED.defect && e.detail === "WHITE_PAGES/mover/ADDRESS.md: household: Our Little Cottage");
  assert.deepEqual(registryLines(t.dir), lines, "the key line is not written, so nothing marks the act complete");
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

// ── H6 the lock ─────────────────────────────────────────────────────────────

const rowsOf = async () => (await storeRows()).households.map((h) => [h.slug, h.residents]);
const noOpenTx = async (client) => { const { rows: [tx] } = await client.query("SELECT now() = statement_timestamp() AS fresh"); assert.equal(tx.fresh, true, "no transaction is left open on the client"); };

test("H6 · the transaction re-reads under its lock: a house changed since the plan refuses (each precondition), and it rolls back", { skip: SKIP }, async () => {
  const changes = [
    ["the source lost every other resident", "UPDATE households SET residents = ARRAY['mover'] WHERE slug = 'keepers'", /keepers: \[mover\]/],
    ["the mover left the source", "UPDATE households SET residents = array_remove(residents, 'mover') WHERE slug = 'keepers'", /keepers: \[warden, clerk, scribe\]/],
    ["the mover joined the target", "UPDATE households SET residents = array_append(residents, 'mover') WHERE slug = 'harbor'", /harbor: \[pilot, mover\]/],
    ["the target is gone", "DELETE FROM households WHERE slug = 'harbor'", /harbor: gone/],
  ];
  for (const [why, sql, detail] of changes) {
    const t = await town();
    await withPen(t, async () => planHousemate({ ...ARGS, rows: await loadRegistryRows(), clone: t.dir, date: D }));
    await ownerQuery(sql);
    const before = await rowsOf();
    const owner = await asOwner();
    try {
      await assert.rejects(moveHousemateInStore(owner, ARGS), (e) => e.defect === MOVE_ROW_REFUSALS.MOVED.defect && detail.test(e.detail), why);
      await noOpenTx(owner);
    } finally { await owner.end(); }
    assert.deepEqual(await rowsOf(), before, `${why}: nothing moved`);
  }
  // the source and the target are never the same row
  const owner = await asOwner();
  try { await assert.rejects(moveHousemateInStore(owner, { ...ARGS, to: "keepers" }), (e) => e.defect === MOVE_ROW_REFUSALS.MOVED.defect); await noOpenTx(owner); } finally { await owner.end(); }
});

test("H6b · A FAILURE AFTER THE FIRST WRITE ROLLS EVERYTHING BACK: the source's residents are not left without the mover and the target without them", { skip: SKIP }, async () => {
  await town();
  const before = await storeRows();
  const real = await asOwner();
  // a client whose second UPDATE (the target's) fails, after the source's has been written inside the transaction
  const failing = { query: async (sql, params) => {
    if (/^UPDATE households/.test(sql) && params?.[0] === "harbor") throw Object.assign(new Error("a fixture failure after the first write"), { code: "XX000" });
    return real.query(sql, params);
  } };
  try {
    await assert.rejects(moveHousemateInStore(failing, ARGS), /a fixture failure after the first write/);
    await noOpenTx(real);
  } finally { await real.end(); }
  assert.deepEqual(await storeRows(), before, "the first UPDATE was rolled back with it");
});

// ── H7 unavailable is not zero, and nothing secret is read ──────────────────

async function pool() {
  const { default: pg } = await import("pg");
  const p = new pg.Pool({ connectionString: IX.store.url("office_api"), max: 1 });
  p.on("error", () => {});
  return p;
}

test("H7 · a count or credential fact that cannot be read says UNAVAILABLE, never zero and never cleared; no key hash or note body is ever selected", { skip: SKIP }, async () => {
  await seedHistory();
  const t = await town();
  const p = await pool();
  try {
    // a table the store does not have (renamed away for this leg only): its count is unavailable, the others still answer
    await ownerQuery("ALTER TABLE letter_notes RENAME TO letter_notes_away");
    try {
      const h = await historyCounts({ pool: p, handle: "mover", from: "keepers" });
      assert.match(h.tables["notes (letter_notes)"].unavailable, /letter_notes/);
      assert.equal(h.tables["notes (letter_notes)"].in_source_set, undefined, "not a zero");
      assert.equal(h.tables.acts.in_source_set, 3, "the other tables still answer");
      const text = describe((await dry(t)).plan, { dryRun: true, evidence: { history: h, credentials: null } });
      assert.match(text, /notes \(letter_notes\): UNAVAILABLE — /);
    } finally { await ownerQuery("ALTER TABLE letter_notes_away RENAME TO letter_notes"); }

    // the tokens table gone: every key fact is unavailable, and the verdict is "unknown", not false
    const rows = await loadRegistryRows();
    await ownerQuery("ALTER TABLE oauth_tokens RENAME TO oauth_tokens_away");
    try {
      const c = await credentialImpact({ pool: p, handle: "scribe", from: "keepers", to: "harbor", rows });
      assert.match(c.static_keys.unavailable, /oauth_tokens/);
      assert.match(c.live_sign_in_keys.unavailable, /oauth_tokens/);
      assert.equal(c.sign_in.listed_in_source, false, "scribe's account is not one the source lists");
      assert.equal(c.bound_to_source, "unknown", "nothing says yes and a path could not be read: not false");
      const m = await credentialImpact({ pool: p, handle: "mover", from: "keepers", to: "harbor", rows });
      assert.equal(m.bound_to_source, true, "a path that says yes still says yes");
    } finally { await ownerQuery("ALTER TABLE oauth_tokens_away RENAME TO oauth_tokens"); }

    // all paths readable and none bound: false (the control that "unknown" above is the unreadable table, not a default)
    const clear = await credentialImpact({ pool: p, handle: "scribe", from: "keepers", to: "harbor", rows });
    assert.deepEqual(clear.static_keys, { count: 0, keys: [] });
    assert.equal(clear.bound_to_source, false);
    const none = await credentialImpact({ pool: p, handle: "ghost", from: "keepers", to: "harbor", rows });
    assert.equal(none.sign_in.pinned_account, null);
    assert.equal(none.bound_to_source, "unknown", "no pin to read: unknown");

    // NO SECRET: the report as a whole carries no hash and no body
    const all = JSON.stringify({ c: await credentialImpact({ pool: p, handle: "mover", from: "keepers", to: "harbor", rows }), h: await historyCounts({ pool: p, handle: "mover", from: "keepers" }) });
    assert.doesNotMatch(all, /synthetic-hash|SYNTHETIC-NOTE-BODY|token_hash/);
  } finally { await p.end(); }
  // and the office is not pointed at a record at all: everything is unavailable, nothing is zero
  const out = await withPen(t, () => moveHousemate({ ...ARGS, clone: t.dir, date: D, dryRun: true, open: async () => null, ...NO_WRITERS }));
  assert.deepEqual(out.evidence.history, { unavailable: "the office is not pointed at the record" });
  assert.match(describe(out.plan, { dryRun: true, evidence: out.evidence }), /history counts: UNAVAILABLE — the office is not pointed at the record/);
});

test("H8 · the printout's exact lines: lineDiff shows what changed and nothing it did not", () => {
  const a = ["{", '  "a": [', '    "x",', '    "y"', "  ],", '  "b": 1', "}"].join("\n");
  const b = ["{", '  "a": [', '    "x"', "  ],", '  "b": 1', "}"].join("\n");
  assert.deepEqual(lineDiff(a, b).lines, ['-    "x",', '-    "y"', '+    "x"']);
  assert.deepEqual(lineDiff(a, a).lines, [], "equal printouts differ by no line");
});
