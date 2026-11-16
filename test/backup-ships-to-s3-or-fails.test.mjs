// backup-ships-to-s3-or-fails.test.mjs — STAR-118. With the git ship retired,
// the S3 bucket is the backup lane's one off-box route, so the two ways it can
// fail to leave the box must fail the unit, and the one way it can succeed must
// reach `shipped`:
//
//   unset bucket    W2_S3_BUCKET empty: exit 1, the receipt reads failed at
//                   `ship`, and nothing is uploaded
//   failed upload   the upload returns 1: exit 1, failed at `ship`
//   shipped         the upload succeeds: exit 0, the receipt reads `shipped`,
//                   and the night's files went up with LATEST.json last
//
// THE PROGRAM UNDER TEST IS THE LANE'S OWN: § 4 to the end of
// deploy/world2-backup.sh, with its own fail(), the real world2-lib.sh (so the
// real w2_ship_s3 and w2_state), and a stub `aws` function. Only the
// stages before § 4 (pg_dump, the base backup, the copies) are stood in by
// their variables.
//
//   node --test test/backup-ships-to-s3-or-fails.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LANE = readFileSync("deploy/world2-backup.sh", "utf8");
const LIB = resolve("deploy/world2-lib.sh");
const scratch = mkdtempSync(join(tmpdir(), "star118-ship-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const posix = (p) => p.replace(/\\/g, "/");
const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this machine";

function laneFrom4() {
  const from = LANE.indexOf("\n# ── 4 · off-box");
  assert.ok(from > 0, "deploy/world2-backup.sh has no § 4 off-box stage: it moved and this test measures nothing");
  return LANE.slice(from);
}
function laneFail() {
  const m = LANE.match(/\nfail\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, "deploy/world2-backup.sh has no fail(): its one exit path moved");
  return m[0];
}

// `aws s3 cp <src> s3://…` → copy <src> into s3/ and log it (AWS_STUB=ok), or refuse (AWS_STUB=fail)
const STUB = `#!/bin/bash
echo "$*" >> "$AWS_STUB_LOG"
[ "$AWS_STUB" = ok ] || { echo "stub: upload refused" >&2; exit 1; }
for a in "$@"; do case "$a" in s3://*|--*|s3|cp) ;; *) src="$a" ;; esac; done
cp "$src" "$AWS_STUB_DIR/"
`;

function run({ bucket, stub }) {
  const dir = mkdtempSync(join(scratch, "night-"));
  const p = (...s) => posix(join(dir, ...s));
  for (const d of ["bin", "lab", "state", "dumps", "base", "wal", "intake", "s3", "tmp"]) mkdirSync(join(dir, d));
  writeFileSync(join(dir, "bin", "aws"), STUB, { mode: 0o755 });
  writeFileSync(join(dir, "dumps", "world2-20261112T081000Z.dump"), "a custom-format dump\n");
  writeFileSync(join(dir, "intake", "wallets-registrations.jsonl"), '{"act":"register"}\n');
  const harness = join(dir, "harness.sh");
  writeFileSync(harness, [
    "set -uo pipefail",
    `WORLD2_LAB='${p("lab")}'; WORLD2_STATE_DIR='${p("state")}'; WORLD2_ENV_FILE='${p("no-env")}'`,
    `. '${posix(LIB)}'`,
    // the lib's w2_json_escape is python3, which is the box's and never this machine's (CRAFT: no python, ever): the
    // same escape in node, so fail()'s detail is written the same way without it
    `w2_json_escape() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s.trim().slice(-600))))'; }`,
    // and if anything in the lane still reached for python, it says so instead of running it
    `python3() { echo "$*" >> '${p("python.log")}'; return 127; }; python() { python3 "$@"; }`,
    // its own TMPDIR, so the ship's staging dir (mktemp -t) is checked for leaks after every run
    `export TMPDIR='${p("tmp")}'`,
    // a function, not a PATH entry: it shadows a real aws on the runner, and a Windows path's drive colon can't split PATH
    `aws() { bash '${p("bin", "aws")}' "$@"; }`,
    `export AWS_STUB='${stub}' AWS_STUB_LOG='${p("aws.log")}' AWS_STUB_DIR='${p("s3")}'`,
    laneFail(),
    // what §§ 1–3 leave behind on an in-store night
    `DUMPS='${p("dumps")}'; BASEBACKUPS='${p("base")}'; WAL='${p("wal")}'; KEEP_DUMPS=14; KEEP_BASE=3`,
    `STAMP=20261112T081000Z; DB=world2_dev; DUMP='${p("dumps", "world2-20261112T081000Z.dump")}'; DUMP_BYTES=21; TOC_ENTRIES=3`,
    "NOTARY_OFFBOX=ok; NOTARY_LOCAL=abc; NOTARY_PUSHED=abc; BASE_OK=true; BASE_BYTES=1",
    "ROLES_STATUS=in-store; ROLES_SRC=store; ROLES_COPY=''; ROLES_BYTES=0; ROLES_AUDIT=2; ROLES_GRANTS=2",
    `INTAKE_STATUS='"wallets":{"status":"copied","bytes":19}'; INTAKE_UNREAD=''; INTAKE_STAGE='${p("intake")}'`,
    `W2_S3_BUCKET='${bucket}'`,
    laneFrom4(),
  ].join("\n"));
  const r = spawnSync("bash", [harness], { encoding: "utf8" });
  const statePath = join(dir, "state", "backup.json");
  return {
    code: r.status,
    stderr: r.stderr,
    state: existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null,
    calls: existsSync(join(dir, "aws.log")) ? readFileSync(join(dir, "aws.log"), "utf8").trim().split("\n") : [],
    uploaded: readdirSync(join(dir, "s3")).sort(),
    leftInTmp: readdirSync(join(dir, "tmp")),
    python: existsSync(join(dir, "python.log")),
  };
}

// every night, shipped or failed, leaves no staging dir behind (the EXIT trap removes it), and runs no python here
const noLeak = (r) => {
  assert.deepEqual(r.leftInTmp, [], `the ship's staging dir leaked: ${r.leftInTmp.join(", ")}`);
  assert.equal(r.python, false, "the harnessed lane called python on this machine");
};

test("an unset bucket fails the unit at ship, and nothing goes up", { skip: bash }, () => {
  // the stub would SUCCEED here: a lane without the guard would ship to "s3:///…" and read shipped
  const r = run({ bucket: "", stub: "ok" });
  assert.equal(r.code, 1, `an unset bucket exited ${r.code}: the dump would be on the box alone and the unit green`);
  assert.equal(r.state?.status, "failed");
  assert.equal(r.state?.stage, "ship");
  assert.match(r.state?.detail ?? "", /NOWHERE ELSE/);
  assert.deepEqual(r.calls, [], "the lane called aws with no bucket");
  noLeak(r);
});

test("a failed upload fails the unit at ship", { skip: bash }, () => {
  const r = run({ bucket: "a-bucket", stub: "fail" });
  assert.equal(r.code, 1, `a refused upload exited ${r.code}: the night would read as shipped with nothing off the box`);
  assert.equal(r.state?.status, "failed");
  assert.equal(r.state?.stage, "ship");
  assert.match(r.state?.detail ?? "", /S3 upload to s3:\/\/a-bucket\/world2\/20261112T081000Z failed/);
  assert.equal(r.calls.length, 1, "the lane kept uploading after the first refusal");
  noLeak(r);
});

test("a good upload reaches shipped, with the night's files up and LATEST.json last", { skip: bash }, () => {
  const r = run({ bucket: "a-bucket", stub: "ok" });
  assert.equal(r.code, 0, `the shipped night exited ${r.code}: ${r.stderr.slice(-300)}`);
  assert.equal(r.state?.status, "shipped");
  assert.equal(r.state?.s3, "s3://a-bucket/world2/20261112T081000Z (4 files)");
  assert.match(r.state?.destination ?? "", /^s3:\/\/a-bucket\/world2\//);
  assert.deepEqual(r.uploaded, ["LATEST.json", "wallets-registrations.jsonl", "world2-20261112T081000Z.dump", "world2-20261112T081000Z.dump.sha256"]);
  // LATEST.json goes LAST, so a night with a LATEST.json is a night whose upload finished (the cold restore reads it so)
  assert.match(r.calls.at(-1), /LATEST\.json s3:\/\/a-bucket\/world2\/20261112T081000Z\/LATEST\.json/);
  assert.ok(r.calls.every((c) => c.startsWith("s3 cp ")), "the lane made an aws call other than s3 cp");
  noLeak(r);
});
