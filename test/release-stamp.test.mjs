// release-stamp.test.mjs — POS-60: the office's deploy receipt.
//
// THE LAW THIS ASSERTS, quoted verbatim from deploy/DEPLOY.md's live-truth note
// (2026-07-19), because a falsifier that paraphrases its law drifts off it:
//
//   "a code deploy is `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/`
//    + `sudo systemctl restart postmark-office`, then probe a route whose
//    response only the new code produces (a restart alone proves nothing)."
//
// The clause under test is the parenthesis. `GET /release` is the route whose
// response only the newly-deployed code produces, and these cases pin the three
// ways it could quietly stop being that:
//
//   1. a stamp that names a release  -> the door reports THAT release  (it works)
//   2. no stamp at all               -> `deployed: false`, never green  (a
//      hand-placed box, and every box before this shipped, must still boot)
//   3. a stamp that is present but says nothing usable -> also not green (a
//      truncated or half-written file must not read as a successful deploy)
//
// And the second law, from OPERATIONS.md § Deploys (founder-ruled 2026-08-26):
//
//   "code moves on trains; the record is never promoted — it is either alive
//    (prod) or certified-frozen (dev)."
//
// which is why the stamp carries `target`: a receipt that cannot say whether it
// was the prod hand or the dev hand that wrote it lets a rehearsal be mistaken
// for a release.
//
//   node --test test/release-stamp.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readReleaseStamp, RELEASE_STAMP_FILE } from "../src/release.mjs";

const root = () => mkdtempSync(join(tmpdir(), "postmark-release-"));

test("a stamped office reports the release it is running", () => {
  const dir = root();
  try {
    writeFileSync(join(dir, RELEASE_STAMP_FILE), JSON.stringify({
      tag: "release/2026-w35.1",
      sha: "0123456789abcdef0123456789abcdef01234567",
      deployed_at: "2026-08-26T12:00:00.000Z",
      target: "prod",
      run: "https://github.com/postmark-town/postmark-office/actions/runs/1",
    }));

    const r = readReleaseStamp(dir);
    assert.equal(r.deployed, true);
    assert.equal(r.tag, "release/2026-w35.1");
    assert.equal(r.sha, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(r.target, "prod");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an office placed by hand has no stamp, boots anyway, and never reads green", () => {
  const dir = root();
  try {
    const r = readReleaseStamp(dir);
    assert.equal(r.deployed, false);
    assert.match(r.reason, /no release\.json/);
    assert.equal(r.tag, undefined, "an unstamped office must not invent a tag");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a half-written stamp is not a deploy", () => {
  for (const body of ['{"tag":"release/2026-w35"}', '{"sha":"abc"}', "{}", "not json at all", '{"tag":"","sha":""}']) {
    const dir = root();
    try {
      writeFileSync(join(dir, RELEASE_STAMP_FILE), body);
      const r = readReleaseStamp(dir);
      assert.equal(r.deployed, false, `a stamp of ${body} must not read as deployed`);
      assert.ok(r.reason, "and it must say why, so the operator is not left guessing");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

// THE CAN-FAIL FLIP. The three cases above are only worth anything if the reader
// can actually tell the states apart — a reader hard-wired to `deployed: true`
// would pass case 1 and fail 2 and 3, and one hard-wired to `false` the reverse.
// This asserts the discrimination directly: the same reader, two roots, two
// answers. If this ever passes with a constant reader, the suite has gone vacuous.
test("the reader discriminates — the same code answers differently for the two states", () => {
  const stamped = root();
  const bare = root();
  try {
    writeFileSync(join(stamped, RELEASE_STAMP_FILE), JSON.stringify({ tag: "release/2026-w99", sha: "deadbeef" }));
    assert.notEqual(
      readReleaseStamp(stamped).deployed,
      readReleaseStamp(bare).deployed,
      "a stamped and an unstamped office must not look the same to the probe",
    );
  } finally {
    rmSync(stamped, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});
