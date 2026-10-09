// paperwork-repair.test.mjs — the clean week's repair (POS-271; Darko
// 2026-10-09: "repair and keep the date").
//
// The mirror wrote every store write to the files after the store, and on
// 10-05 and 10-09 some of those writes failed, so the files are behind the
// store by exactly those rows. `paperwork-import --repair` rewrites the rows
// --check flags, in the FILES, from the store (the record), and checks again.
// On a real store, the 10-09 shape:
//
//   P1  drift the way the outage left it (token rows the store deleted and the
//       file kept, a pair the store inserted and the file lacks, an expiry the
//       store changed, a role audit row the file lacks): --check names each;
//       --repair makes the files equal, the store is unchanged, and every row
//       --check did not flag is byte-for-byte as it was
//   P2  the CLI: --repair exits 0 with "repaired", a second --check exits 0
//
//   node --test test/paperwork-repair.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { openRolesDb, grantRole } from "../src/roles.mjs";
import { importPaperwork, repairFiles } from "../world2/tools/paperwork-import.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "paperwork-repair-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const T0 = 1_790_000_000;
const token = (hash, kind, expires) => [hash, kind, 999, "keeminlee", "cl", expires, T0];
const INS = "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?)";

async function filesInStore(name) {
  const store = await startStore({ db: name });
  CLEANUP.push(() => store.stop());
  const files = { oauth: join(TMP, `${name}-oauth.db`), roles: join(TMP, `${name}-roles.db`) };
  const o = openOauthDb(files.oauth);
  for (const [h, k, e] of [["keep-a", "access", T0 + 9e5], ["keep-r", "refresh", T0 + 9e5], ["gone-1", "refresh", T0 + 9e5], ["gone-2", "access", T0 + 9e5], ["moved", "access", T0 + 100]])
    o.prepare(INS).run(...token(h, k, e));
  o.close();
  const r = openRolesDb(files.roles);
  await grantRole(r, { subject: 101, actor: "keemin", note: "before the outage" });
  r.close();
  const owner = await store.connect("world2_owner");
  CLEANUP.push(() => owner.end());
  const copied = await importPaperwork(owner, files);
  assert.ok(copied.committed, "the fixture's copy committed");
  // THE OUTAGE: the store took these writes and the mirror did not.
  await owner.query("DELETE FROM oauth_tokens WHERE token_hash IN ('gone-1', 'gone-2')");
  await owner.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ('new-a', 'access', 999, 'keeminlee', 'cl', $1, $2), ('new-r', 'refresh', 999, 'keeminlee', 'cl', $1, $2)", [T0 + 9e5, T0 + 50]);
  await owner.query("UPDATE oauth_tokens SET expires = $1 WHERE token_hash = 'moved'", [T0 + 200]);
  await owner.query("INSERT INTO office_role_audit (at, action, subject, role, login, actor, note) VALUES ('2026-10-09T08:00:00Z', 'grant', '102', 'subscriber', 'h2', 'keemin', 'during the outage')");
  await owner.query("INSERT INTO office_roles (subject, role, login, granted_at, granted_by, note) VALUES ('102', 'subscriber', 'h2', '2026-10-09T08:00:00Z', 'keemin', 'during the outage')");
  return { store, files, owner };
}

const rowsOf = (path, table) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => JSON.parse(JSON.stringify(r))); }
  finally { db.close(); }
};

test("P1 · --repair makes the files equal the store, row by flagged row, and touches nothing else", async () => {
  const { files, owner } = await filesInStore("repair_p1");
  const storeBefore = (await owner.query("SELECT token_hash, expires FROM oauth_tokens ORDER BY token_hash")).rows;
  const keepBefore = rowsOf(files.oauth, "tokens").filter((r) => r.token_hash.startsWith("keep-"));

  const r = await repairFiles(owner, files);
  const flagged = r.before.tables.flatMap((t) => t.differ).join("\n");
  for (const want of [/gone-1.*in the file, not in the store/, /gone-2.*in the file, not in the store/, /new-a.*in the store, not in the file/,
    /new-r.*in the store, not in the file/, /moved.*\.expires/, /office_role_audit .*in the store, not in the file/, /office_roles .*102.*in the store, not in the file/])
    assert.match(flagged, want, "the first check names each row the outage left behind");
  assert.ok(r.equal, `the files equal the store after the repair: ${JSON.stringify(r.after.tables.filter((t) => t.differ.length))}`);
  assert.deepEqual(r.repaired.map((t) => [t.table, t.rows]).sort(), [["office_role_audit", 1], ["office_roles", 1], ["oauth_tokens", 5]].sort());

  const after = rowsOf(files.oauth, "tokens");
  assert.deepEqual(after.map((x) => x.token_hash).sort(), ["keep-a", "keep-r", "moved", "new-a", "new-r"]);
  assert.equal(after.find((x) => x.token_hash === "moved").expires, T0 + 200, "the changed expiry is the store's");
  assert.deepEqual(after.filter((x) => x.token_hash.startsWith("keep-")), keepBefore, "rows --check did not flag are untouched");
  assert.deepEqual((await owner.query("SELECT token_hash, expires FROM oauth_tokens ORDER BY token_hash")).rows, storeBefore, "the store is only read");
});

test("P2 · the CLI: --repair exits 0 and says so; --check then exits 0", async () => {
  const { store, files } = await filesInStore("repair_p2");
  const cli = (...flags) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(ROOT, "world2/tools/paperwork-import.mjs"), "--pg-url", store.url("world2_owner"),
        "--oauth-db", files.oauth, "--roles-db", files.roles, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  };
  assert.equal(cli("--check").code, 1, "the drift reads as DRIFT first");
  const repaired = cli("--repair");
  assert.equal(repaired.code, 0, repaired.out);
  assert.match(repaired.out, /repaired; the files now equal the store/);
  const checked = cli("--check");
  assert.equal(checked.code, 0, checked.out);
  assert.match(checked.out, /checked; nothing written/);
});
