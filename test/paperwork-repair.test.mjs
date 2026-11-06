// paperwork-repair.test.mjs — the clean week's repair (POS-271; Darko
// 2026-10-09: "repair and keep the date").
//
// The mirror wrote every store write to the files after the store, and on
// 10-05 and 10-09 some of those writes failed. Prod's --check (Wright,
// 2026-10-09) named only rows "in the store, not in the file": two tokens and
// one town-log row. `paperwork-import --repair` does exactly that and nothing
// else: it INSERTS into the files the rows only the store holds, never deletes,
// never overwrites, and refuses (writing nothing) on anything else. On a real
// store:
//
//   P1  the prod shape (tokens, a town-log row, a role and its audit row the
//       store took and the file lacks): --repair inserts them, --check then
//       reads equal, the store is unchanged, every other file row is as it was
//   P2  a row that differs in content: refused, exit 2, the files untouched
//   P3  a row only the file holds: refused, exit 2, the files untouched
//   P4  the CLI: --repair exits 0, prints counts and never a key; --check exits 0
//
//   node --test test/paperwork-repair.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { openRolesDb, grantRole } from "../src/roles.mjs";
import { appendTownJournal } from "../src/town-journal.mjs";
import { importPaperwork, repairFiles } from "../world2/tools/paperwork-import.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "paperwork-repair-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const T0 = 1_790_000_000;
const INS = "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?)";
const hashOf = (tag) => createHash("sha256").update(tag).digest("base64url");

// The files and their copy in the store, as the import leaves them.
async function filesInStore(name) {
  const store = await startStore({ db: name });
  CLEANUP.push(() => store.stop());
  const files = { oauth: join(TMP, `${name}-oauth.db`), roles: join(TMP, `${name}-roles.db`) };
  const o = openOauthDb(files.oauth);
  for (const tag of ["keep-a", "keep-r"]) o.prepare(INS).run(hashOf(tag), tag.endsWith("r") ? "refresh" : "access", 999, "keeminlee", "cl", T0 + 9e5, T0);
  await appendTownJournal(o, { cls: "letter", act: "send", household: "keeminlee", handle: "wright", payload: { args: { to: "limen" } } });
  o.close();
  const r = openRolesDb(files.roles);
  await grantRole(r, { subject: 101, actor: "keemin", note: "before the outage" });
  r.close();
  const owner = await store.connect("world2_owner");
  CLEANUP.push(() => owner.end());
  assert.ok((await importPaperwork(owner, files)).committed, "the fixture's copy committed");
  return { store, files, owner };
}

// The prod shape: the store took these writes and the mirror did not.
async function storeOnlyRows(owner) {
  await owner.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ($1, 'access', 999, 'keeminlee', 'cl', $3, $4), ($2, 'refresh', 999, 'keeminlee', 'cl', $3, $4)",
    [hashOf("new-a"), hashOf("new-r"), T0 + 9e5, T0 + 50]);
  await owner.query("INSERT INTO office_town_journal (class, act, household, handle, payload, written_at, channel) SELECT class, 'home', household, handle, payload, written_at, channel FROM office_town_journal LIMIT 1");
  await owner.query("INSERT INTO office_roles (subject, role, login, granted_at, granted_by, note) VALUES ('102', 'subscriber', 'h2', '2026-10-09T08:00:00Z', 'keemin', 'during the outage')");
  await owner.query("INSERT INTO office_role_audit (at, action, subject, role, login, actor, note) VALUES ('2026-10-09T08:00:00Z', 'grant', '102', 'subscriber', 'h2', 'keemin', 'during the outage')");
}

const rowsOf = (path, table) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => JSON.parse(JSON.stringify(r))); }
  finally { db.close(); }
};
const bytesOf = (files) => [readFileSync(files.oauth), readFileSync(files.roles)].map((b) => hashOf(b.toString("base64")));

test("P1 · the prod shape: the store's missing rows are inserted into the files, and nothing else moves", async () => {
  const { files, owner } = await filesInStore("repair_p1");
  await storeOnlyRows(owner);
  const tokensBefore = rowsOf(files.oauth, "tokens");
  const storeBefore = (await owner.query("SELECT token_hash, expires FROM oauth_tokens ORDER BY token_hash")).rows;

  const r = await repairFiles(owner, files);
  for (const t of r.before.tables) for (const d of t.differ) assert.match(d, /in the store, not in the file/, "the drift is all store-only rows");
  assert.ok(r.equal, `the files equal the store after the repair: ${JSON.stringify(r.after.tables.filter((t) => t.differ.length).map((t) => t.table))}`);
  assert.deepEqual(r.repaired.map((t) => [t.table, t.inserted]).sort(),
    [["oauth_tokens", 2], ["office_role_audit", 1], ["office_roles", 1], ["office_town_journal", 1]].sort());
  const tokensAfter = rowsOf(files.oauth, "tokens");
  assert.deepEqual(tokensAfter.slice(0, tokensBefore.length), tokensBefore, "every row the file held is as it was");
  assert.deepEqual(tokensAfter.slice(tokensBefore.length).map((x) => x.token_hash).sort(), [hashOf("new-a"), hashOf("new-r")].sort());
  assert.deepEqual((await owner.query("SELECT token_hash, expires FROM oauth_tokens ORDER BY token_hash")).rows, storeBefore, "the store is only read");
});

test("P2 · a row that differs in content is refused, and nothing is written", async () => {
  const { files, owner } = await filesInStore("repair_p2");
  await storeOnlyRows(owner);
  await owner.query("UPDATE oauth_tokens SET expires = expires + 100 WHERE token_hash = $1", [hashOf("keep-a")]);
  const before = bytesOf(files);
  await assert.rejects(repairFiles(owner, files), (e) => e.exit === 2 && /oauth_tokens: 1 row\(s\) differ in content/.test(e.message) && /nothing was written/.test(e.message));
  assert.deepEqual(bytesOf(files), before, "the files are untouched, the store-only rows included");
});

test("P3 · a row only the file holds is refused, and nothing is written", async () => {
  const { files, owner } = await filesInStore("repair_p3");
  await owner.query("DELETE FROM oauth_tokens WHERE token_hash = $1", [hashOf("keep-r")]);
  const before = bytesOf(files);
  await assert.rejects(repairFiles(owner, files), (e) => e.exit === 2 && /oauth_tokens: 1 row\(s\) are in the file and not in the store/.test(e.message));
  assert.deepEqual(bytesOf(files), before, "never a delete");
});

test("P4 · the CLI: --repair exits 0 and prints counts, never a key; --check then exits 0", async () => {
  const { store, files, owner } = await filesInStore("repair_p4");
  await storeOnlyRows(owner);
  const cli = (...flags) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(ROOT, "world2/tools/paperwork-import.mjs"), "--pg-url", store.url("world2_owner"),
        "--oauth-db", files.oauth, "--roles-db", files.roles, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  };
  assert.equal(cli("--check").code, 1, "the drift reads as DRIFT first");
  const repaired = cli("--repair");
  assert.equal(repaired.code, 0, repaired.out);
  assert.match(repaired.out, /repaired\s+oauth_tokens\s+2 row\(s\) inserted/);
  assert.match(repaired.out, /repaired; the files now equal the store/);
  for (const tag of ["new-a", "new-r", "keep-a"]) assert.ok(!repaired.out.includes(hashOf(tag)), "the repair's output never prints a token hash");
  const checked = cli("--check");
  assert.equal(checked.code, 0, checked.out);
});
