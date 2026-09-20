// Falsifiers for the terminal-refusal transport.
//
//   node --test test/settlement-escalate.test.mjs
//
// THE LAW THIS ASSERTS. Two of the settlement's exits are terminal — no rerun
// on this box can clear either — and both used to end as a red unit and one
// journal line at 02:39:26Z:
//
//   Aug 31 02:39:26  SETTLEMENT-SWEEP-REFUSAL {"cause": … ,"phase":"unknown"}
//   Aug 31 02:39:27  postmark-settlement.service: Failed with result 'exit-code'
//
// A `canon-bad` refusal repeats every twelve hours by construction, so the
// transport's second obligation is as load-bearing as the first: UPDATE, NEVER
// DUPLICATE. An escalation that filed a fresh issue per crossing would bury the
// operator queue in a week and teach its reader to close them unread, which is a
// louder version of the silence it replaces.
//
// The HTTP half is driven against a stub `fetch`, so every test states outright
// what GitHub answered.

import test from "node:test";
import assert from "node:assert/strict";

import {
  escalate, titleFor, bodyFor, tokenFrom, DEFAULT_REPO, isSuiteRedRefusal, notOkLines,
} from "../deploy/settlement-escalate.mjs";

const REPO = "postmark-town/postmark";

// The receipt a canon-bad crossing writes, in the shape settlement-receipt.mjs
// composes it.
const CANON_RECEIPT = {
  at: "2026-08-31T02:39:26Z",
  status: "refused",
  class: "canon-bad",
  next_step: "NO RERUN CAN CLEAR THIS. WORLD/marks/let-there-be-light/the-protected-grove/the-mushroom-greenhouse is in origin/main's own tree",
  world_from: "dbed7311f5f489e5e73687df5253917ea8357a46",
  channels: { published: 0, left_drafted: 57 },
};

/** A stub GitHub. `issues` is the open listing; every write is recorded. */
function stubGithub({ issues = [], failCreate = false, failComment = false } = {}) {
  const calls = [];
  const fetchStub = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === "GET" && url.includes("/issues?state=open")) {
      const page = Number(new URL(url).searchParams.get("page") || 1);
      return new Response(JSON.stringify(page === 1 ? issues : []), { status: 200 });
    }
    if (method === "POST" && /\/issues\/\d+\/comments$/.test(url)) {
      return failComment
        ? new Response("{}", { status: 403 })
        : new Response(JSON.stringify({ id: 1 }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/issues")) {
      return failCreate
        ? new Response("{}", { status: 410 })
        : new Response(JSON.stringify({ number: 2400, html_url: "https://github.com/x/2400" }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchStub };
}

// AWAITED, deliberately. A synchronous `try/finally` around an async fn restores
// the real fetch the instant the promise is created — before a single request is
// made — and every test below would then be talking to api.github.com for real.
async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const quiet = () => {};

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: with no standing issue, a terminal refusal is FILED, once", async () => {
  // Without this, "it did not duplicate" below would be indistinguishable from
  // "it never files anything at all".
  const { calls, fetchStub } = stubGithub({ issues: [] });
  const r = await withFetch(fetchStub, () =>
    escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: "t", repo: REPO, log: quiet }));

  assert.equal(r.filed, true);
  assert.equal(r.updated, false);
  assert.equal(r.number, 2400);
  const created = calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues"));
  assert.equal(created.length, 1, "a terminal refusal filed more than one issue");
  assert.equal(created[0].body.title, "settlement refusal: canon-bad");
  assert.match(created[0].body.body, /NO RERUN CAN CLEAR THIS/,
    "the issue does not carry the next step, so the reader is where the old journal line left them");
});

// ── §1 UPDATE, NEVER DUPLICATE ──────────────────────────────────────────────

test("a standing OPEN issue with the same title is COMMENTED on, never filed again", () => {
  // A canon-bad refusal recurs every twelve hours by construction. Twice a day,
  // forever, is what "no rerun can clear it" means in a queue.
  const standing = { number: 2268, title: titleFor("canon-bad"), html_url: "https://github.com/x/2268" };
  const { calls, fetchStub } = stubGithub({ issues: [standing] });
  return withFetch(fetchStub, async () => {
    const r = await escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: "t", repo: REPO, log: quiet });
    assert.equal(r.filed, true);
    assert.equal(r.updated, true);
    assert.equal(r.number, 2268);
    assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, 0,
      "it filed a duplicate beside the issue it had already found");
    assert.equal(calls.filter((c) => c.url.endsWith("/issues/2268/comments")).length, 1);
  });
});

test("the match is EXACT — a near-miss title is a different finding and gets its own issue", () => {
  // "settlement refusal: race" and "settlement refusal: canon-bad" are two
  // different nights with two different removal lanes. Folding one into the
  // other would put a terminal record fault under a heading about contention.
  const near = { number: 9, title: "settlement refusal: race", html_url: "" };
  const { calls, fetchStub } = stubGithub({ issues: [near] });
  return withFetch(fetchStub, async () => {
    const r = await escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: "t", repo: REPO, log: quiet });
    assert.equal(r.updated, false);
    assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, 1);
  });
});

test("a PULL REQUEST with the same title is not mistaken for the standing issue", () => {
  // GitHub's /issues listing returns pull requests too. Commenting on a PR
  // instead of filing the issue would leave the operator queue empty while the
  // escalation reported success.
  const pr = { number: 77, title: titleFor("canon-bad"), pull_request: { url: "…" } };
  const { calls, fetchStub } = stubGithub({ issues: [pr] });
  return withFetch(fetchStub, async () => {
    const r = await escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: "t", repo: REPO, log: quiet });
    assert.equal(r.updated, false, "it commented on a pull request and called the refusal delivered");
    assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, 1);
  });
});

// ── §2 a transport that fails says ISSUE-WANTED and never fails the crossing ─

test("no credential: ISSUE-WANTED, loudly, with the whole body it would have filed", async () => {
  const said = [];
  const r = await escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: null, repo: REPO, log: (m) => said.push(m) });

  assert.equal(r.filed, false);
  assert.equal(r.reason, "no-credential");
  const all = said.join("\n");
  assert.match(all, /ISSUE-WANTED/);
  assert.match(all, /settlement refusal: canon-bad/);
  assert.match(all, /NO RERUN CAN CLEAR THIS/,
    "a gap that swallows the finding is worse than the journal line it replaces");
});

test("GitHub refusing the write is ISSUE-WANTED too — the finding is never swallowed", () => {
  const { fetchStub } = stubGithub({ issues: [], failCreate: true });
  const said = [];
  return withFetch(fetchStub, async () => {
    const r = await escalate({ klass: "canon-bad", receipt: CANON_RECEIPT, token: "t", repo: REPO, log: (m) => said.push(m) });
    assert.equal(r.filed, false);
    assert.match(r.reason, /^create-410$/);
    assert.match(said.join("\n"), /ISSUE-WANTED/);
    assert.match(said.join("\n"), /NO RERUN CAN CLEAR THIS/);
  });
});

// ── §3 the credential and the repo name ─────────────────────────────────────

test("the token comes out of the office's own git credential store, and nothing else does", () => {
  // Measured on the box 2026-08-31: /srv/postmark-office/.git-credentials holds
  // `https://postmark-pen:<token>@github.com`. No new secret, no new path.
  assert.equal(tokenFrom("https://postmark-pen:ghp_EXAMPLE123@github.com\n"), "ghp_EXAMPLE123");
  assert.equal(tokenFrom("https://user:tok@gitlab.com\n"), null, "a non-github line answered as a github token");
  assert.equal(tokenFrom(""), null);
  assert.equal(tokenFrom(null), null);
});

test("the default repo is the town's real name, not the one that 301-redirects", () => {
  // `keeminlee/postmark` answers 301 to `postmark-town/postmark` (measured
  // 2026-08-31), and the GitHub API does not follow a redirect for a POST — an
  // escalation aimed at the old name would silently file nothing.
  assert.equal(DEFAULT_REPO, "postmark-town/postmark");
});

test("the body quotes the receipt verbatim — a summary of a refusal is a thing to debug", () => {
  const body = bodyFor("canon-bad", CANON_RECEIPT);
  assert.ok(body.includes(JSON.stringify(CANON_RECEIPT, null, 1)), "the receipt was summarised rather than quoted");
  assert.match(body, /UPDATED, never duplicated/, "nothing tells the reader why the comments pile up here");
});

test("a race escalation says its own next step — it is contention, and nothing needs repairing", () => {
  // A raced-out crossing has no record fault at all: telling its reader to go
  // repair something would send them looking for a bug that is not there.
  const body = bodyFor("race", { at: "2026-08-30T17:54:45Z", status: "race", class: null });
  assert.match(body, /contention, not a transient/);
  assert.match(body, /next scheduled crossing tries again on its own/);
});

test("a recurring-refusal escalation speaks OVER the receipt's own next_step", () => {
  // Two classes override it, and for the same reason: for those two the
  // per-crossing advice has stopped being true, and repeating it is what wasted
  // the three days this exists to end. A recurring refusal's receipt still says
  // "rerunnable AFTER the source is repaired" — correct about that crossing,
  // and exactly the advice that had already been followed and had not worked.
  const body = bodyFor("recurring-refusal", CANON_RECEIPT);
  assert.match(body, /THE RERUN HAS STOPPED BEING THE ANSWER/);
  assert.match(body, /upstream of the rerun/);
  assert.match(body, /7f866059/, "the escalation does not point at the repair whose shape this is");
  // The receipt is still quoted whole below it, so its next_step is available
  // as evidence rather than as the headline.
  assert.ok(body.includes(JSON.stringify(CANON_RECEIPT, null, 1)));
});

test("its title is its own, so it never lands on the canon-bad issue", () => {
  // Different findings, different removal lanes. Folding one into the other
  // would file a recurring drawer fault under a heading about world main.
  assert.equal(titleFor("recurring-refusal"), "settlement refusal: recurring-refusal");
  assert.notEqual(titleFor("recurring-refusal"), titleFor("canon-bad"));
});

// ── §4 A SUITE RED ESCALATES ON THE FIRST OCCURRENCE (#2793) ────────────────
//
// THE INSTANCE. 2026-09-14 05:45Z, the S70 crossing: "grammar suite red and the
// isolation pass could not attribute it to a mark this crossing carried — a
// finding for the keeper, not a retry". That run's journal carries the refusal
// and nothing else — no `[settlement-escalate]` line, no issue, no ping — because
// the only path to this file for a suite red was `recurring-refusal`, i.e. the
// THIRD unsettled crossing in a row. The operator round found it at 12:35Z.

/** The receipt the UNATTRIBUTABLE exit writes, in settlement-receipt.mjs's shape. */
const SUITE_RECEIPT = {
  at: "2026-09-14T05:45:00Z",
  status: "refused",
  // ⚑ VERBATIM from `deploy/settlement-auto.sh`'s own `report refused` line. The
  // gate below matches on these words, so this string is the law it quotes: a
  // reworded refusal must redden here rather than quietly turn the alarm off.
  detail: "grammar suite red and the isolation pass could not attribute it to a mark this crossing carried — a finding for the keeper, not a retry",
  class: null,
  next_step: null,
  isolated: null,
  channels: { published: 0, left_drafted: 0 },
};

/** And the isolate-off exit's, whose wording is the shorter of the two. */
const SUITE_RECEIPT_NO_ISOLATE = {
  ...SUITE_RECEIPT,
  detail: "grammar suite red — a finding for the keeper, not a retry",
};

const SUITE_LOG = [
  "TAP version 13",
  "ok 1 - the town's own grammar",
  "not ok 12 - WORLD/marks/the-town/pledges names a mark canon does not carry",
  "  ---",
  "  operator: deepEqual",
  "  ...",
  "not ok 40 - a household line the register has no row for",
  "1..41",
].join("\n");

test("FALSIFIER 1 · the suite-red body quotes the `not ok` lines and the isolate's verdict", async () => {
  // The two things a person needs before they can act, and neither is in the
  // receipt: the receipt says the suite was red, and every question after that —
  // red at WHAT, and is it one mark's — is answered by these and nothing else.
  const { calls, fetchStub } = stubGithub({ issues: [] });
  const r = await withFetch(fetchStub, () => escalate({
    klass: "suite-red", receipt: SUITE_RECEIPT, token: "t", repo: REPO, log: quiet,
    suiteLog: SUITE_LOG, isolate: "unattributable",
  }));

  assert.equal(r.filed, true, "the FIRST suite red must reach a person — that is the whole of #2793");
  const created = calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues"));
  assert.equal(created.length, 1);
  assert.equal(created[0].body.title, "settlement refusal: suite-red");

  const body = created[0].body.body;
  assert.match(body, /not ok 12 - WORLD\/marks\/the-town\/pledges names a mark canon does not carry/);
  assert.match(body, /not ok 40 - a household line the register has no row for/);
  assert.doesNotMatch(body, /ok 1 - the town's own grammar/,
    "the greens are not the finding, and a body that carries the whole log is a body nobody reads");
  assert.doesNotMatch(body, /TAP version 13/);

  assert.match(body, /### The isolation pass/);
  assert.match(body, /IT RAN AND ATTRIBUTED NOTHING/,
    "without the isolator's verdict the reader cannot tell a law-level red from one mark's");
  assert.match(body, /postmark-settlement-by-hand\.service/,
    "and it must say how to finish the crossing once the repair lands, or the fix waits for the clock");

  // The receipt still goes in whole, below: a summary of a refusal is how an
  // operator ends up debugging the summary.
  assert.ok(body.includes(JSON.stringify(SUITE_RECEIPT, null, 1)));
});

test("FALSIFIER 2 · the isolate-off exit says the pass DID NOT RUN, not that it found nothing", () => {
  // `isolated: null` on the receipt for BOTH exits — a pass that attributed
  // nothing writes no isolate report — so the two are indistinguishable from the
  // receipt alone. Reading one as the other would send a person hunting a
  // law-level red when nothing had looked at the marks yet.
  const ran = bodyFor("suite-red", SUITE_RECEIPT, { suiteLog: SUITE_LOG, isolate: "unattributable" });
  const never = bodyFor("suite-red", SUITE_RECEIPT_NO_ISOLATE, { suiteLog: SUITE_LOG, isolate: "not-run" });
  assert.match(never, /IT DID NOT RUN/);
  assert.match(never, /SETTLEMENT_ISOLATE=0/);
  assert.doesNotMatch(never, /ATTRIBUTED NOTHING/);
  assert.notEqual(ran, never, "one verdict wearing the other's words is the freshness-stamp defect");

  // And a caller that names no verdict is told so rather than guessed at.
  assert.match(bodyFor("suite-red", SUITE_RECEIPT, { suiteLog: SUITE_LOG }), /NOT SAID/);
});

test("FALSIFIER 3 · a receipt that is not a suite-red refusal FILES NOTHING", async () => {
  // `--class` is an argument. A stale `settlement-auto.json` from the crossing
  // that PUBLISHED, a half-written one, a hand-typed rerun of the escalator —
  // each would file an issue about a red that is not there, and a queue that
  // cries wolf is this file's own silence wearing a louder coat.
  const cases = [
    ["a published crossing", { at: "x", status: "published", detail: "14 published" }],
    ["a refusal of another kind", { at: "x", status: "refused", detail: "sweep tripped: lint said 2 errors" }],
    ["a receipt that could not be read", null],
  ];
  for (const [what, receipt] of cases) {
    const { calls, fetchStub } = stubGithub({ issues: [] });
    const r = await withFetch(fetchStub, () => escalate({
      klass: "suite-red", receipt, token: "t", repo: REPO, log: quiet,
      suiteLog: SUITE_LOG, isolate: "unattributable",
    }));
    assert.equal(r.filed, false, `${what} filed an issue`);
    assert.equal(r.reason, "not-a-suite-red-refusal");
    assert.deepEqual(calls, [], `${what} reached GitHub at all — the gate must come before the request`);
  }

  // The control: the same gate PASSES both real suite-red refusals, or the test
  // above would be satisfied by a gate that refuses everything.
  assert.equal(isSuiteRedRefusal(SUITE_RECEIPT), true);
  assert.equal(isSuiteRedRefusal(SUITE_RECEIPT_NO_ISOLATE), true);
});

test("FALSIFIER 4 · the `not ok` cap names its own denominator", () => {
  // A capped list that stops silently reads as the whole list, and the count is
  // the thing an operator is judging. (List caps are silent denominators.)
  const many = Array.from({ length: 57 }, (_, i) => `not ok ${i + 1} - a red`).join("\n");
  const lines = notOkLines(many);
  assert.equal(lines.length, 41, "forty reds plus the line that says how many were left out");
  assert.match(lines.at(-1), /17 more `not ok` line\(s\) — 57 in total/);

  // An empty log and an unreadable one are different facts, and the body says
  // them differently: one is a suite that named no test, the other a missing
  // instrument.
  assert.deepEqual(notOkLines(""), []);
  assert.deepEqual(notOkLines(null), []);
  assert.match(bodyFor("suite-red", SUITE_RECEIPT, { suiteLog: "", isolate: "not-run" }),
    /carries NO `not ok` line/);
  assert.match(bodyFor("suite-red", SUITE_RECEIPT, { suiteLog: null, isolate: "not-run" }),
    /could not be read at escalation time/);
});

test("FALSIFIER 5 · its title is its own, so it never lands on another class's issue", () => {
  // Different findings, different removal lanes — and this one recurs every
  // twelve hours like canon-bad does, so it needs its own standing issue to
  // comment on rather than burying a world-main fault under a suite heading.
  assert.equal(titleFor("suite-red"), "settlement refusal: suite-red");
  assert.notEqual(titleFor("suite-red"), titleFor("canon-bad"));
  assert.notEqual(titleFor("suite-red"), titleFor("recurring-refusal"));
});
