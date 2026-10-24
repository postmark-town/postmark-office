// hearing-window.test.mjs — where the ear's window opens (POS-226).
//
// A throwaway world repo with crossings dated by hand: the window is the newest
// `settlement: sweep` commit on main (the box's publish), never the tag, never
// the heartbeat; a refused crossing publishes nothing and so resets nothing.
//   node --test test/hearing-window.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHearingWindow, publishedSettlementAt, publishedSettlementsAt, blessedSettlementAt, hearable } from "../src/hearing-window.mjs";

function world() {
  const repo = mkdtempSync(join(tmpdir(), "postmark-hearing-"));
  const git = (args, date = null) => execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  });
  git(["init", "-q", "-b", "main"]);
  let n = 0;
  const commit = (subject, date) => { writeFileSync(join(repo, "f"), String(++n)); git(["add", "f"]); git(["commit", "-q", "-m", subject], date); };
  return { repo, git, commit };
}

test("the window opens at world main's newest sweep commit — not the tag, and not a later non-sweep commit", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  w.git(["tag", "-a", "settlement/S85", "-m", "bless"], "2026-09-27T19:10:08Z");
  w.commit("settlement: household registry re-derived", "2026-09-28T06:00:09Z");
  w.commit("settlement: sweep 12 published", "2026-09-28T06:00:51Z");   // published, not yet blessed
  w.commit("crossing-save 217", "2026-09-28T12:02:47Z");
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-28T06:00:51.000Z");
  assert.equal(new Date(await blessedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:34.000Z", "the tag lags the publish");
  const h = createHearingWindow({ repo: w.repo });
  const got = await h.refresh();
  assert.equal(new Date(got.since).toISOString(), "2026-09-28T06:00:51.000Z");
  assert.equal(got.disclosure, null);
});

test("a refused crossing resets nothing: with no new sweep commit the window stays where it was", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  // the 06:00Z heartbeat refused: nothing published, only the ferry's save
  w.commit("crossing-save 216", "2026-09-28T06:30:00Z");
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:34.000Z");
});

test("origin/main counts: a box whose local main lags reads the published truth", async () => {
  const w = world();
  w.commit("settlement: sweep 1 published", "2026-09-27T06:00:00Z");
  w.git(["branch", "-m", "main", "old"]);
  w.commit("settlement: sweep 2 published", "2026-09-27T18:00:00Z");
  w.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  w.git(["branch", "-f", "main", "old"]);
  w.git(["checkout", "-q", "main"]);
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:00.000Z");
});

test("main unreadable: the newest tag stands in, and the answer says so", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  w.git(["tag", "-a", "settlement/S85", "-m", "bless"], "2026-09-27T19:10:08Z");
  const h = createHearingWindow({ repo: w.repo, published: async () => { throw new Error("git is stuck"); } });
  const got = await h.refresh();
  assert.equal(new Date(got.since).toISOString(), "2026-09-27T18:00:34.000Z");
  assert.match(got.disclosure, /newest BLESSED settlement/);
});

test("the say path never waits: read() answers from memory, and a failed refresh leaves the last answer standing", async () => {
  let clock = 0;
  let calls = 0;
  let answer = Date.UTC(2026, 8, 28, 6, 0, 51);
  const h = createHearingWindow({ repo: "unused", clock: () => clock, refreshMs: 60_000,
    published: async () => { calls += 1; if (answer === "throw") throw new Error("down"); return answer; },
    blessed: async () => { throw new Error("down"); } });
  assert.equal(h.read(), null, "nothing known before the first answer — and no wait for it");
  await h.refresh();
  assert.equal(h.read().since, answer);
  const before = calls;
  h.read();
  assert.equal(calls, before, "inside the refresh interval nothing is re-asked");
  clock += 60_000;
  const kept = answer;
  answer = "throw";
  h.read();
  await h.refresh();
  assert.equal(h.read().since, kept, "a reader that trips leaves the last answer standing");
});

// ── ONE WINDOW, EVERY EAR (POS-693) ─────────────────────────────────────────

test("hearable: born inside the window and not after the instant; an unknown window cuts nothing", () => {
  const since = Date.UTC(2026, 9, 19, 6, 1, 41);
  const at = since + 6 * 3600_000;
  assert.equal(hearable(since, at, since), true, "spoken the instant the window opened");
  assert.equal(hearable(since + 3600_000, at, since), true, "six hours is not five minutes");
  assert.equal(hearable(since - 1, at, since), false, "before the settlement");
  assert.equal(hearable(at + 1, at, since), false, "not yet spoken");
  assert.equal(hearable(since - 86_400_000, at, null), true, "an unknown window reaches back");
});

test("an earlier instant opens at its own settlement, read off the same sweeps", async () => {
  const w = world();
  w.commit("settlement: sweep 1 published", "2026-10-18T06:00:30Z");
  w.commit("settlement: sweep 2 published", "2026-10-18T18:00:40Z");
  w.commit("crossing-save 256", "2026-10-18T20:00:00Z");
  w.commit("settlement: sweep 3 published", "2026-10-19T06:01:41Z");
  assert.deepEqual((await publishedSettlementsAt(w.repo)).map((ms) => new Date(ms).toISOString()),
    ["2026-10-19T06:01:41.000Z", "2026-10-18T18:00:40.000Z", "2026-10-18T06:00:30.000Z"]);
  const h = createHearingWindow({ repo: w.repo });
  await h.refresh();
  const iso = (r) => new Date(r.since).toISOString();
  assert.equal(iso(h.read()), "2026-10-19T06:01:41.000Z", "the live ear: the newest");
  assert.equal(iso(h.read(Date.parse("2026-10-19T09:00:00Z"))), "2026-10-19T06:01:41.000Z");
  assert.equal(iso(h.read(Date.parse("2026-10-18T23:00:00Z"))), "2026-10-18T18:00:40.000Z", "the sweep before, not the save after it");
  assert.equal(iso(h.read(Date.parse("2026-10-18T06:00:30Z"))), "2026-10-18T06:00:30.000Z", "a sweep's own instant opens its own window");
  const old = h.read(Date.parse("2026-10-17T12:00:00Z"));
  assert.equal(old.since, null);
  assert.match(old.disclosure, /older than the 3 settlements/);
});
