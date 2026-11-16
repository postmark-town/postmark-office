// rehearsal-lets-transient-tables-shrink.test.mjs — STAR-118. The restore
// rehearsal's row-count rule, RUN rather than read.
//
// The rule: a live table may be ahead of the restored one (the town kept
// moving), but a restored table with MORE rows than live means the dump and the
// live store disagree about history, and that's a finding. The exception is the
// office's transient credential tables, whose rows are swept or spent by design
// (031_office_paperwork.sql: "none of this is the record"). On 11-12 the --from-s3
// rehearsal read oauth_pending 2 restored vs 1 live, a pending sign-in that
// completed or expired between the 08:10 dump and the count, and failed on it.
//
//   transient   oauth_pending shrinking since the dump is expected, not a finding
//   strict      every other table, office_role_audit and office_roles among them,
//               still reddens when the restore has more
//   the clock   live ahead of the restore is expected everywhere
//
// THE PROGRAM UNDER TEST IS THE SCRIPT'S OWN: the rule and its loop are cut out of
// deploy/world2-restore-rehearse.sh and run against stubbed counts.
//
//   node --test test/rehearsal-lets-transient-tables-shrink.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REHEARSE = readFileSync("deploy/world2-restore-rehearse.sh", "utf8");
const scratch = mkdtempSync(join(tmpdir(), "star118-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this machine";

function loop() {
  const from = REHEARSE.indexOf("# THE TRANSIENT TABLES");
  assert.ok(from > 0, "the rehearsal has no transient-tables rule: it moved and this test measures nothing");
  const end = REHEARSE.indexOf("\ndone\n", from);
  assert.ok(end > from, "the rehearsal's count loop has no end after its rule");
  return REHEARSE.slice(from, end + 6);
}

// counts: { table: [restored, live] }
function run(counts) {
  const tables = Object.keys(counts);
  const arr = (i) => tables.map((t) => `[${t}]=${counts[t][i]}`).join(" ");
  const harness = join(scratch, "harness.sh");
  writeFileSync(harness, [
    "set -uo pipefail",
    "SCRATCH=restore_test; DB=live",
    `declare -A R=(${arr(0)}) L=(${arr(1)})`,
    // psql_owner --dbname <db> -tAc 'SELECT count(*) FROM "<t>"'
    'psql_owner() { local t="${4#*FROM \\"}"; t="${t%\\"}"; if [ "$2" = "$SCRATCH" ]; then echo "${R[$t]}"; else echo "${L[$t]}"; fi; }',
    `TABLES="${tables.join(" ")}"`,
    loop(),
    'echo "BAD=$bad"',
  ].join("\n"));
  const out = execFileSync("bash", [harness], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { out, bad: Number(out.match(/^BAD=(\d+)$/m)[1]) };
}

const line = (out, t) => out.split("\n").find((l) => l.trim().startsWith(t + " ")) || "";

test("the 11-12 night: oauth_pending shrank since the dump, and that is not a finding", { skip: bash }, () => {
  const r = run({ oauth_pending: [2, 1], claims: [5, 7], office_role_audit: [2, 2], office_roles: [2, 2] });
  assert.match(line(r.out, "oauth_pending"), /live -1 \(swept or spent since the dump — a transient table, expected\)/);
  assert.match(line(r.out, "claims"), /live \+2 \(town moved since the dump — expected\)/);
  assert.match(line(r.out, "office_role_audit"), /match/);
  assert.equal(r.bad, 0, "the rehearsal failed on a swept sign-in, which is the sweep working");
});

test("every other table keeps the strict rule: a restore with more rows is still a finding", { skip: bash }, () => {
  let r = run({ office_role_audit: [3, 2] });
  assert.match(line(r.out, "office_role_audit"), /RESTORED HAS MORE \(\+1\) — HISTORY DISAGREES/);
  assert.equal(r.bad, 1, "the append-only audit losing a row did NOT redden — the rule proves nothing");

  r = run({ office_roles: [3, 2], oauth_clients: [4, 3], claims: [9, 8] });
  assert.equal(r.bad, 3, "a non-transient table shrinking was let through: only the swept credential tables may");
});

test("the transient list is exactly the swept and spent credential tables", () => {
  const m = REHEARSE.match(/^TRANSIENT="([^"]*)"$/m);
  assert.ok(m, "the rehearsal names no TRANSIENT list");
  assert.deepEqual(m[1].split(/\s+/).sort(), ["oauth_codes", "oauth_key_claims", "oauth_pending", "oauth_tokens"]);
});
