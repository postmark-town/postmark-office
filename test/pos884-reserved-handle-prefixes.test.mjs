// pos884-reserved-handle-prefixes.test.mjs — the town's one reserved-prefix rule
// (berth-, human-of-) at the office's residency door and its town drain (POS-884).
//
//   node --test test/pos884-reserved-handle-prefixes.test.mjs
//
// THE RULE IS THE TOWN'S, carried here as a byte copy: vendor/tools/reserved-handles.mjs,
// whose header names postmark-town/postmark tools/reserved-handles.mjs and its sha256
// (scripts/check-vendor-drift.mjs holds the copy to it). The office restates neither prefix
// as a check of its own. The settle pass's two roads and its door are proven in
// settle-join.test.mjs (§ POS-884); this file holds the residency door, the crossing, and the
// office's own two labels the rule exists to protect.
//
// Every reserved handle below passes the handle grammar, so the refusal it meets is the
// prefix rule's and no other, and an ordinary handle beside it is admitted.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RESERVED_HANDLE_PREFIXES, reservedHandlePrefix } from "../vendor/tools/reserved-handles.mjs";
import { validateResidencyRequest, isResidentHandle, REGISTRY_PATH } from "../src/residency.mjs";
import { BERTH_PREFIX, berthHandleOf, standingOf } from "../src/speaker-standing.mjs";
import { humanHandFor } from "../src/households.mjs";
import { fixtureTown } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { appendTownJournal, pendingRows } from "../src/town-journal.mjs";
import { runTownDrain, TOWN_DOORS } from "../src/town-bridge.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

const RESERVED = [["berth-inv-tide", "berth-"], ["human-of-inv-reed", "human-of-"]];
const ruleSentence = (h, prefix) => new RegExp(`^handle "${h}" wears the ${prefix} reserved prefix \\(the reserved-prefix rule: no resident handle begins with berth- or human-of-\\)`);

// ── the labels the rule protects are the office's own ─────────────────────────

test("the two labels the office mints for non-residents each wear a prefix the vendored rule reserves", async () => {
  assert.deepEqual(Object.keys(RESERVED_HANDLE_PREFIXES), ["berth-", "human-of-"]);
  assert.equal(reservedHandlePrefix(berthHandleOf({ berth: true, slug: "inv-tide" })), BERTH_PREFIX, "a berth's voice (speaker-standing.mjs)");
  assert.equal(standingOf(berthHandleOf({ berth: true, slug: "inv-tide" })), "visitor");
  assert.equal(reservedHandlePrefix(await humanHandFor(["inv-reed"], () => null)), "human-of-", "a household's human (households.mjs)");
});

// ── the residency door (validateResidencyRequest: the residency, held-bind and declare roads) ──

test("POS-884 · the residency door refuses each reserved prefix with the rule's sentence, beside an ordinary handle it admits", () => {
  const mem = { hasResident: () => false }; // nobody lives here yet (index-probe.mjs § probeOf)
  for (const [h, prefix] of RESERVED) {
    assert.ok(isResidentHandle(h), `${h} passes the grammar, so the refusal is the prefix rule's`);
    assert.throws(() => validateResidencyRequest({ handle: h, card: "an invented card" }, mem), (e) => {
      assert.equal(e.code, 409);
      assert.equal(e.defect, `"${h}" wears a reserved prefix`);
      assert.match(e.hint, ruleSentence(h, prefix));
      return true;
    });
  }
  assert.equal(validateResidencyRequest({ handle: "inv-moss", card: "an invented card" }, mem).handle, "inv-moss");
});

// ── the crossing (town-drain.mjs § planTownDrain) ────────────────────────────

const trash = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `pm-${tag}-`)); trash.push(d); return d; };
test.after(() => { for (const d of trash.splice(0)) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS will */ } } });

function townClone() {
  const dir = tmp("pos884-town");
  mkdirSync(join(dir, "WHITE_PAGES", "wright"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "wright", "ADDRESS.md"), "---\nhandle: wright\ngithub: gh-wright\nsince: 2026-01-01\n---\n\n# wright\n");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-08-01 · registry: someone = hh:elsewhere\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// A verified join row, as the declare door appends it (gangway-drain.test.mjs § seedJoin).
const seedJoin = (o, handle, ghId) => appendTownJournal(o, {
  cls: "join", act: "declare-household", household: `${handle}-house`, handle,
  ghId, ghLogin: `${handle}-gh`,
  payload: { household: `${handle}-house`, card: `${handle}'s invented card.` },
});

test("POS-884 · the crossing skips each reserved prefix by the rule's sentence and lands nothing for it; the ordinary row settles", async () => {
  const clone = townClone();
  const o = openOauthDb(join(tmp("pos884-odb"), "oauth.db"));
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    await seedJoin(o, "berth-inv-tide", "900000881");
    await seedJoin(o, "human-of-inv-reed", "900000882");
    await seedJoin(o, "inv-moss", "900000883");
    let pool;
    const r = await withRecordFrom(clone, (p) => {
      pool = p;
      return runTownDrain(o, { db: fixtureTown(), doors: TOWN_DOORS, lockHeld: () => true, log: () => {}, clone, date: "2026-11-04" });
    });
    assert.equal(r.ran, true, JSON.stringify(r));
    assert.deepEqual(r.settled, ["inv-moss"], "the ordinary row settles");
    for (const [h, prefix] of RESERVED) {
      const skip = r.skipped_rows.find((s) => s.handle === h);
      assert.ok(skip, `${h} is judged and skipped: ${JSON.stringify(r.skipped_rows)}`);
      assert.match(skip.why, ruleSentence(h, prefix));
      assert.equal(existsSync(join(clone, "WHITE_PAGES", h)), false, `${h}: no address`);
      assert.equal(pool.state.pins.some((p) => p.handle === h), false, `${h}: no pin`);
      assert.equal(pool.state.households.some((x) => (x.residents ?? []).includes(h) || x.slug === `${h}-house`), false, `${h}: no house, no membership`);
      assert.doesNotMatch(readFileSync(join(clone, REGISTRY_PATH), "utf8"), new RegExp(h), `${h}: not in the printed registry`);
    }
    assert.ok(existsSync(join(clone, "WHITE_PAGES", "inv-moss", "ADDRESS.md")));
    assert.deepEqual(await pendingRows(o), [], "judged and done: nothing is left pending for the next crossing to re-judge");
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    o.close();
  }
});
