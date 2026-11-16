// static-keys-no-residents.test.mjs — a static key that acts for NO resident (POS-1041).
//
// Why this exists. Wright, 2026-11-14 08:58 EST, on STAR-182: "File (b), the tool
// allowing an empty list, as a small w48 follow-up so the next one goes by the
// tool." Darko's go that morning (08:54 EST, "yeah scoped to no resident") asked
// for a founder-household key that names no resident. The import's own parse
// matched `<key>=<household>:<handles>` with `(.+)` after the colon, so the tool
// could not mint one, and the row was written by hand.
//
// RULED (the issue's "Done when"): "a no-resident static key can be minted by the
// tool alone, and the suite pins its refusals." The ask: "let an entry with an
// empty handle list (`<key>=<household>:` …) import as `handles: []`", and the
// gates refuse it on acts: write `from`, media, fund, stake, branches, standing,
// and `as: "human"` (humanStand: "no residents on this key").
//
//   § 1  the parse: `<key>=<household>:` is `handles: []`; what is still malformed
//        is still skipped (no colon, no household, no key)
//   § 2  the import: the row reads back as an empty Set, on the file and on a real
//        Postgres; dry writes nothing; a re-run changes nothing; an edit to and
//        from a scoped list replaces the row
//   § 3  the CLI mints it and prints no key and no piece of a hash
//   § 4  the gates, driven with the credential the lookup returns (the real path:
//        import, then staticLookup), each refusing by its own words, beside a
//        one-resident control
//   § 5  the door: /me answers the key as a static key with no residents
//
// Fixtures are invented. No key in this file is a real one.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-no-residents");
import { oauthSchema, openOauthDb } from "../src/oauth.mjs";
import { paperOnPool, paperworkPoolTypes, asPaper } from "../src/paperwork.mjs";
import { parseOfficeKeys, staticLookup, importStaticKeys } from "../src/static-keys.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-static-keys-none-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
});

const NOBODY = "sk-no-residents";       // `<key>=<household>:`
const NOBODY_PINNED = "sk-no-res-pinned"; // `<key>=<household>#<id>:`
const NOBODY_SPACED = "sk-no-res-spaced"; // whitespace after the colon
const SCOPED = "sk-scoped-one";          // a normal key, beside them
const SPEC = [
  `${NOBODY}=founder-hearth:`,
  `${NOBODY_PINNED}=founder-hearth#583231:`,
  `  ${NOBODY_SPACED}=founder-hearth:   `,
  `${SCOPED}=founder-hearth:wright`,
].join(";");
const TOKENS = [NOBODY, NOBODY_PINNED, NOBODY_SPACED, SCOPED];

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const view = (k) => k && { ...k, handles: [...k.handles] };

const fileDb = (name) => {
  const db = new DatabaseSync(join(TMP, name));
  oauthSchema(db);
  CLEANUP.push(async () => db.close());
  return db;
};

/** The credential the way a door gets it: imported by the tool's own code, then read by the lookup. */
async function credentialFor(token, spec = SPEC) {
  const db = fileDb(`cred-${sha(token).slice(0, 8)}-${Math.random().toString(36).slice(2)}.db`);
  await importStaticKeys(db, spec);
  return staticLookup(db, token);
}

// ── § 1 the parse ────────────────────────────────────────────────────────────

test("§ 1 an empty handle list is handles [], on every spelling of it", () => {
  const { keys, skipped, warnings } = parseOfficeKeys(SPEC);
  assert.equal(skipped, 0, "no entry is malformed");
  assert.deepEqual(warnings, []);
  assert.deepEqual([...keys.keys()], TOKENS, "all four keys parsed, in written order");
  assert.deepStrictEqual(keys.get(NOBODY), { household: "founder-hearth", handles: [], ghId: null });
  assert.deepStrictEqual(keys.get(NOBODY_PINNED), { household: "founder-hearth", handles: [], ghId: 583231 },
    "a pinned gh_id still rides a no-resident key");
  assert.deepStrictEqual(keys.get(NOBODY_SPACED), { household: "founder-hearth", handles: [], ghId: null },
    "trailing whitespace after the colon is still no handles, never [\"\"]");
  assert.deepStrictEqual(keys.get(SCOPED).handles, ["wright"], "a scoped key beside them is unchanged");
});

test("§ 1b what was malformed is still malformed: the colon, the household and the key are required", () => {
  const cases = {
    "no colon at all (a typo must not become a no-resident key)": "k1=founder-hearth",
    "an empty household": "k2=:wright",
    "an empty household and no handles": "k3=:",
    "no key": "=founder-hearth:wright",
    "nothing": "",
  };
  for (const [why, spec] of Object.entries(cases)) {
    const { keys, skipped } = parseOfficeKeys(spec);
    assert.equal(keys.size, 0, why);
    assert.equal(skipped, spec === "" ? 0 : 1, `${why}: counted as skipped`);
  }
  // a malformed entry beside a good empty one costs only itself
  const mixed = parseOfficeKeys("bad=founder-hearth;good=founder-hearth:");
  assert.deepEqual([...mixed.keys.keys()], ["good"]);
  assert.equal(mixed.skipped, 1);
});

test("§ 1c old-code falsifier: the boot parse's `(.+)` skips an empty list, the module's parse does not", () => {
  // The oracle in test/static-keys.test.mjs is the regex this change replaced. It must
  // still skip the new shape, so that test's oracle stays an oracle for the OLD shapes only.
  const OLD = /^([^=]+)=([^:]+):(.+)$/;
  assert.equal(OLD.exec(`${NOBODY}=founder-hearth:`), null, "the old regex refuses it, which is the gap POS-1041 closes");
  assert.equal(parseOfficeKeys(`${NOBODY}=founder-hearth:`).keys.size, 1);
});

// ── § 2 the import ───────────────────────────────────────────────────────────

test("§ 2 on the file: the row reads back as an empty Set, with no gh_id unless one was written", async () => {
  const db = fileDb("s2-oauth.db");
  const out = await importStaticKeys(db, SPEC);
  assert.deepEqual([out.entries, out.added, out.skipped, out.outcome], [4, 4, 0, "complete"]);
  assert.deepEqual(out.households, ["founder-hearth"]);
  const a = await staticLookup(db, NOBODY);
  assert.ok(a.handles instanceof Set && a.handles.size === 0, "an empty Set, not a Set holding an empty string");
  assert.deepStrictEqual(view(a), { household: "founder-hearth", handles: [] }, "no ghId on an unpinned key");
  assert.equal((await staticLookup(db, NOBODY_PINNED)).ghId, 583231);
  assert.equal((await staticLookup(db, NOBODY_SPACED)).handles.size, 0);
  assert.deepEqual([...(await staticLookup(db, SCOPED)).handles], ["wright"]);
  assert.equal(db.prepare("SELECT handles FROM tokens WHERE token_hash = ?").get(sha(NOBODY)).handles, "[]",
    "the column holds the JSON the lookup parses, '[]'");
});

test("§ 2b dry writes nothing, a re-run changes nothing, an edit to and from a scoped list replaces", async () => {
  const db = fileDb("s2b-oauth.db");
  const count = () => db.prepare("SELECT count(*) AS n FROM tokens WHERE kind = 'static'").get().n;
  const dry = await importStaticKeys(db, SPEC, { dry: true });
  assert.deepEqual([dry.added, dry.replaced, dry.unchanged], [4, 0, 0]);
  assert.equal(count(), 0, "a dry run writes nothing");
  await importStaticKeys(db, SPEC);
  const again = await importStaticKeys(db, SPEC);
  assert.deepEqual([again.added, again.replaced, again.unchanged], [0, 0, 4], "idempotent: sameRow reads [] as [] ");
  // a scoped key narrowed to none: the row is REPLACED (office_api holds no UPDATE), and it is still one row
  const narrowed = await importStaticKeys(db, `${SCOPED}=founder-hearth:`);
  assert.equal(narrowed.replaced, 1);
  assert.equal((await staticLookup(db, SCOPED)).handles.size, 0);
  // and a no-resident key given a resident
  const widened = await importStaticKeys(db, `${NOBODY}=founder-hearth:wright`);
  assert.equal(widened.replaced, 1);
  assert.deepEqual([...(await staticLookup(db, NOBODY)).handles], ["wright"]);
  assert.equal(count(), 4, "four keys throughout, never five");
});

test("§ 2c on a real Postgres: office_api writes and reads the '[]' row", async () => {
  const store = await startStore({ db: "static_keys_no_residents" });
  CLEANUP.push(() => store.stop());
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2, types: paperworkPoolTypes(pg) });
  CLEANUP.push(() => pool.end());
  const paper = paperOnPool(pool);
  const first = await importStaticKeys(paper, SPEC);
  assert.equal(first.added, 4);
  assert.deepStrictEqual(view(await staticLookup(paper, NOBODY)), { household: "founder-hearth", handles: [] });
  assert.equal((await pool.query("SELECT handles FROM oauth_tokens WHERE kind = 'static' AND household = 'founder-hearth' AND gh_id IS NULL AND handles = '[]'")).rows.length, 2,
    "two unpinned no-resident rows (the plain one and the spaced one)");
  const second = await importStaticKeys(paper, SPEC);
  assert.deepEqual([second.added, second.replaced, second.unchanged], [0, 0, 4]);
});

test("§ 2d a retired no-resident key is refused by name, never written back", async () => {
  const db = fileDb("s2d-oauth.db");
  await importStaticKeys(db, `${NOBODY}=founder-hearth:;${SCOPED}=founder-hearth:wright`);
  // what the retire tool leaves: the static row replaced by a `retired` row on the same hash (src/static-keys-retire.mjs)
  const row = db.prepare("SELECT token_hash, household, handles, created FROM tokens WHERE token_hash = ?").get(sha(NOBODY));
  db.prepare("DELETE FROM tokens WHERE token_hash = ? AND kind = 'static'").run(row.token_hash);
  db.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, household, handles) VALUES (?, 'retired', NULL, NULL, NULL, NULL, ?, ?, ?)")
    .run(row.token_hash, row.created, row.household, row.handles);
  const out = await importStaticKeys(db, `${NOBODY}=founder-hearth:;${SCOPED}=founder-hearth:wright`);
  assert.deepEqual([out.outcome, out.retired_refused, out.unchanged, out.added], ["partial", 1, 1, 0]);
  assert.deepEqual(out.retired, ["founder-hearth:"], "named by household and its (empty) handles, never the key");
  assert.equal(await staticLookup(db, NOBODY), null, "and the retired key resolves nothing");
});

// ── § 3 the CLI ──────────────────────────────────────────────────────────────

test("§ 3 the CLI mints a no-resident key and prints no key and no piece of a hash", () => {
  const path = join(TMP, "s3-oauth.db");
  const run = (args) => spawnSync(process.execPath, [join(ROOT, "tools", "static-keys-import.mjs"), "--oauth-db", path, ...args], {
    env: { ...process.env, OFFICE_PAPERWORK_STORE: "", OFFICE_KEYS: SPEC }, encoding: "utf8" });
  for (const args of [["--dry"], [], [], ["--json"]]) {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    const said = r.stdout + r.stderr;
    assert.doesNotMatch(said, /malformed/, "no entry is reported malformed");
    for (const t of TOKENS) {
      assert.equal(said.includes(t), false, `the key ${t} was printed`);
      const h = sha(t);
      for (let i = 0; i + 6 <= h.length; i++) assert.equal(said.includes(h.slice(i, i + 6)), false, `a piece of ${t}'s hash was printed`);
    }
    assert.match(said, /founder-hearth/);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare("SELECT handles FROM tokens WHERE kind = 'static' ORDER BY token_hash").all().map((r) => r.handles).sort();
    assert.deepEqual(rows, ['["wright"]', "[]", "[]", "[]"].sort());
  } finally { db.close(); }
});

// ── § 4 the gates ────────────────────────────────────────────────────────────
//
// Every door below is handed the credential the LOOKUP returns for an imported
// no-resident key, not a hand-built `{ handles: new Set() }`. Each is driven
// beside a one-resident control (same household, same call, a resident named),
// so a refusal can be told from a door that refuses everything.

const rejection = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

test("§ 4a write `from`: a letter cannot be sent as any resident", async () => {
  const { validateLetter } = await import("../src/write.mjs");
  const none = await credentialFor(NOBODY);
  const one = await credentialFor(SCOPED);
  const letter = (from) => ({ from, to: "someone-else", title: "t", body: "b" });
  // LAW (the door): "<from> is not one of your residents" (403), before the index is asked anything
  const e = await rejection(() => validateLetter(letter("wright"), none, null));
  assert.equal(e?.code, 403, "a refusal, not a pass");
  assert.match(e.defect, /is not one of your residents/);
  // the control: the one-resident key passes the key check, so it reaches the index probe (db null -> a TypeError, not a 403)
  const c = await rejection(() => validateLetter(letter("wright"), one, null));
  assert.notEqual(c?.code, 403, "the control gets past the key check");
});

test("§ 4b media: an upload names no resident and cannot name one", async () => {
  const { uploadMedia } = await import("../src/media.mjs");
  const none = await credentialFor(NOBODY);
  const bare = await rejection(() => uploadMedia({}, none, null));
  assert.equal(bare?.code, 422);
  assert.match(bare.defect, /which resident uploads this/);
  assert.match(bare.hint, /this key acts for no resident/);
  const named = await rejection(() => uploadMedia({ by: "wright" }, none, null));
  assert.equal(named?.code, 403);
  assert.match(named.defect, /"wright" is not one of your residents/);
  // control: a one-resident key with no `by` resolves its resident and goes past this gate
  const one = await credentialFor(SCOPED);
  const c = await rejection(() => uploadMedia({}, one, null));
  assert.ok(!(c?.code === 422 && /which resident uploads this/.test(c.defect ?? "")), "the control is not asked which resident");
  assert.ok(!(c?.code === 403 && /not one of your residents/.test(c.defect ?? "")), "and is not refused as a stranger");
});

test("§ 4c fund: a payment cannot be witnessed by a key that is nobody's", async () => {
  const { fundVerify } = await import("../src/fund.mjs");
  const none = await credentialFor(NOBODY);
  assert.equal(none.ghId, undefined, "this key holds no account");
  const e = await rejection(() => fundVerify(null, { txhash: "0xinvented", pot: "invented-pot" }, { key: none }));
  assert.equal(e?.code, 403);
  assert.match(e.defect, /names no account and no resident, so it cannot witness a payment/);
  // and naming a handle does not get it past
  const named = await rejection(() => fundVerify(null, { txhash: "0xinvented", pot: "invented-pot", handle: "wright" }, { key: none }));
  assert.equal(named?.code, 403);
  assert.match(named.defect, /cannot witness a payment/);
});

test("§ 4d stake: neither the letter-stake door nor the world's stake door will stake as anyone", async () => {
  const { stakeViaOffice } = await import("../src/votes.mjs");
  const { worldStakeViaOffice, actingAs } = await import("../src/world-stake.mjs");
  const none = await credentialFor(NOBODY);
  const e = await rejection(() => stakeViaOffice(null, { from: "wright", topic: "t", candidate: "c", stamps: 1 }, none));
  assert.equal(e?.code, 403);
  assert.match(e.defect, /"wright" is not one of your residents/);
  assert.match(e.hint, /this key acts for: nobody/);
  const named = actingAs("wright", none);
  assert.equal(named.bounce?.code, 403);
  assert.match(named.bounce.hint, /no residents on this key — sign in, or use a household key/);
  const bare = actingAs(undefined, none);
  assert.equal(bare.bounce?.code, 403);
  assert.match(bare.bounce.defect, /this key acts for no resident/);
  const door = await worldStakeViaOffice({ mark: "someone/a-mark", stamps: 1 }, none, {});
  assert.equal(door.code, 403, "the door itself answers the same bounce");
  assert.equal(actingAs(undefined, await credentialFor(SCOPED)).handle, "wright", "control: a one-resident key stands as its resident");
});

test("§ 4e branches: no draft branch, because the household resolves to null", async () => {
  const { resolvedWorldHousehold } = await import("../src/world-branches.mjs");
  const none = await credentialFor(NOBODY);
  assert.equal(none.household, "founder-hearth", "the key does name a household");
  assert.equal(resolvedWorldHousehold(none), null);
  assert.equal(resolvedWorldHousehold(await credentialFor(SCOPED)), "founder-hearth", "control: the same household, with a resident, resolves");
});

test("§ 4f standing: it cannot stand as a named resident; unnamed it is a spectator at the Origin", async () => {
  const { chooseStandpoint } = await import("../src/world.mjs");
  const none = await credentialFor(NOBODY);
  const named = chooseStandpoint({ handle: "wright" }, none);
  assert.equal(named.bounce?.error, "bounce");
  assert.match(named.bounce.defect, /"wright" is not one of your residents/);
  assert.match(named.bounce.hint, /^no residents on this key — sign in, or use a household key\./);
  const bare = chooseStandpoint({}, none);
  assert.equal(bare.stance, "spectator", "unnamed, a read: it looks from the Origin and stands as nobody");
  assert.equal(bare.handle, undefined);
  assert.equal(chooseStandpoint({}, await credentialFor(SCOPED)).handle, "wright", "control: a one-resident key stands as its resident");
});

test("§ 4g as: human: a human's voice needs a resident to stand beside", async () => {
  const { worldSayHuman } = await import("../src/world.mjs");
  const none = await credentialFor(NOBODY);
  const said = await worldSayHuman({ text: "hello?", human: true }, none);
  assert.equal(said.error, "bounce");
  assert.equal(said.defect, "no residents on this key");
  const named = await worldSayHuman({ text: "hello?", human: true, handle: "wright" }, none);
  assert.equal(named.error, "bounce", "a resident named beside human: true is refused too");
});

test("§ 4h the other doors that stand a caller as a resident: describe and note", async () => {
  const { worldDescribe } = await import("../src/entity-predicates.mjs");
  const { worldNoteViaOffice } = await import("../src/world.mjs");
  const none = await credentialFor(NOBODY);
  const d = await rejection(() => worldDescribe({ slot: "appearance", value: "x", body: "y" }, none));
  assert.equal(d?.code, 422);
  assert.match(d.hint, /no residents on this key — sign in, or use a household key/);
  const n = await rejection(() => worldNoteViaOffice(null, { body: "a note" }, none));
  assert.equal(n?.code, 422);
  assert.match(n.hint, /no residents on this key — sign in, or use a household key/);
  const n2 = await rejection(() => worldNoteViaOffice(null, { handle: "wright", body: "a note" }, none));
  assert.equal(n2?.code, 403);
});

// ── § 5 the door ─────────────────────────────────────────────────────────────

test("§ 5 /me answers the key as a static key with a household and no residents", async () => {
  const town = fixtureTown();
  const ix = await indexStore(town, { db: "static_keys_no_residents_doors" });
  CLEANUP.push(() => ix.stop());
  const oauthPath = join(TMP, "s5-oauth.db");
  openOauthDb(oauthPath).close();
  const seed = new DatabaseSync(oauthPath);
  try { await importStaticKeys(asPaper(seed), SPEC); } finally { seed.close(); }
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(p), "--oauth-db", oauthPath, "--roles-db", `${oauthPath}.roles.db`], {
    env: { ...process.env, ...ix.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "", TOWN_CLONE: join(TMP, "no-clone"),
      WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => child.kill());
  const me = async (key) => {
    const r = await fetch(`http://127.0.0.1:${port}/me`, { headers: { authorization: `Bearer ${key}` } });
    return { status: r.status, body: await r.json() };
  };
  const a = await me(NOBODY);
  assert.equal(a.status, 200, "a key with no residents is still a key");
  assert.equal(a.body.household, "founder-hearth");
  assert.deepEqual(a.body.handles, []);
  assert.equal(a.body.key_kind, "static");
  assert.equal(a.body.visitor, false, "not a visitor: it has a household");
  const pinned = await me(NOBODY_PINNED);
  assert.deepEqual(pinned.body.handles, []);
  assert.equal(pinned.body.verified_github?.id, 583231);
  assert.deepEqual((await me(SCOPED)).body.handles, ["wright"], "control: the scoped key beside it still answers its resident");
  assert.equal((await me("sk-never-imported")).status, 401);
});
