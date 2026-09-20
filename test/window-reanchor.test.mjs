// window-reanchor.test.mjs — the one write that puts the candle's chain on the
// law's marks.
//
// THE DEFECT THESE WATCH. The town's law says the candle closes windows at
// 06:00Z and 18:00Z; the box has closed them at 05:45Z and 17:45Z since the
// cadence was set. Moving the two timers to the law's marks — which this same
// ship does — changes NOTHING about where the windows sit, forever, because the
// candle does not take its marks from the clock. It chains them:
//
//     -- world2/tools/clearing-job.mjs:389-393
//     INSERT INTO windows (id, opens_at, closes_at, status)
//     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
//     [windowId + 1, win.closes_at]
//
// The successor opens at the CLOSED window's stored `closes_at`, never at now().
// So a timer at :00 finds a window still due at :45, closes it late, and writes
// a successor due at :45 again — with the store's own rows contradicting the law
// on every receipt. That is deliberate (world2-clearing.sh: "a late run costs
// lateness, never alignment") and it is exactly why a deliberate move needs one
// deliberate write.
//
// ── WHY THERE IS NO LIVE STORE HERE, SAID PLAINLY ───────────────────────────
//
// There is no non-prod world2 Postgres to point a test at — `/srv/world2-lab`
// IS prod's store — and a falsifier that reached a real store to prove a write
// is careful would be the least careful thing in this lane. So the whole
// DECISION is pure and driven directly, and the impure half is reached through a
// recording `query` seam that captures the exact SQL and parameters a run would
// send. These assert the statements, not an idea of them: a dry run that issued
// an UPDATE would fail here, and so would an apply that issued two.
//
// The prod apply is the founder's, by hand, on ship day. Its receipt is the next
// window opening on the :00 mark with `closes_at` twelve hours later, in the
// store's own rows — not anything this file can stand in for.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nextMarkAtOrAfter, onTheMark, chainNextClose, reanchorPlan, reanchorConsented, main,
} from "../world2/tools/window-reanchor.mjs";

// The box's real shape. The boundary rides at :45:40 — the genesis offset named
// in world2-clearing.sh's boundary-wait note — NOT at :45:00, so the move is
// +14m20s and the re-anchor retires the offset along with the fifteen minutes.
const OPEN_WINDOW = { id: 189, opens_at: "2026-09-17 05:45:40.128+00", closes_at: "2026-09-17 17:45:40.128+00" };

/**
 * A store that records rather than stores. Every call is captured with its SQL
 * and parameters, and `rows` is whatever the script is handed back — so a test
 * can assert both what was asked and what was NOT.
 */
function recordingStore(selectRows, updateRows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params: params ?? null });
      return /^\s*UPDATE/i.test(sql) ? updateRows : selectRows;
    },
  };
}
const quiet = { log: () => {}, err: () => {} };
const capturing = () => {
  const out = [], errs = [];
  return { out, errs, io: { log: (...a) => out.push(a.join(" ")), err: (...a) => errs.push(a.join(" ")) } };
};

// ── the mark, which is the whole rule ────────────────────────────────────────

test("the mark is the next 06:00Z or 18:00Z AT OR AFTER the window's close", () => {
  assert.equal(nextMarkAtOrAfter("2026-09-17T05:45:40.128Z").toISOString(), "2026-09-17T06:00:00.000Z");
  assert.equal(nextMarkAtOrAfter("2026-09-17T17:45:40.128Z").toISOString(), "2026-09-17T18:00:00.000Z");
  // past the evening mark, the next one is the following morning — never backwards
  assert.equal(nextMarkAtOrAfter("2026-09-17T18:30:00Z").toISOString(), "2026-09-18T06:00:00.000Z");
  assert.equal(nextMarkAtOrAfter("2026-09-17T23:59:59Z").toISOString(), "2026-09-18T06:00:00.000Z");
  assert.equal(nextMarkAtOrAfter("2026-09-17T00:00:00Z").toISOString(), "2026-09-17T06:00:00.000Z");
});

test("a close already ON a mark is left exactly where it is", () => {
  // AT OR AFTER, not strictly after. This is what makes a second apply a no-op
  // rather than a twelve-hour shove, and it is decided by the VALUE — never by
  // a memory of having run, which a one-shot an operator types by hand does not
  // have.
  assert.equal(nextMarkAtOrAfter("2026-09-17T06:00:00Z").toISOString(), "2026-09-17T06:00:00.000Z");
  assert.equal(nextMarkAtOrAfter("2026-09-17T18:00:00Z").toISOString(), "2026-09-17T18:00:00.000Z");
  assert.equal(onTheMark("2026-09-17T18:00:00Z"), true);
  assert.equal(onTheMark("2026-09-17T17:45:40.128Z"), false);
});

test("the move is only ever forward, and that is a safety property", () => {
  for (const iso of ["2026-09-17T05:45:40Z", "2026-09-17T17:45:40Z", "2026-09-17T06:00:01Z", "2026-09-17T11:11:11Z"]) {
    assert.ok(nextMarkAtOrAfter(iso).getTime() >= new Date(iso).getTime(),
      `${iso} moved backwards — a close moved into the past is one the runner's own "closes_at <= now()" finds immediately, so the careful write would be followed within the minute by an unplanned crossing`);
  }
});

test("an unparseable close is a throw, never a silent epoch", () => {
  assert.throws(() => nextMarkAtOrAfter("not-a-timestamp"), /unparseable timestamp/);
});

// ── the chain, READ and not changed ──────────────────────────────────────────

test("the chain's next close derives from the mark, and lands on the other mark", () => {
  // clearing-job.mjs's rule, untouched: the successor opens at this close and
  // shuts twelve hours later. The whole point of moving ONE row is that this
  // carries the new mark forward on its own, forever.
  assert.equal(chainNextClose("2026-09-17T18:00:00.000Z").toISOString(), "2026-09-18T06:00:00.000Z");
  assert.equal(chainNextClose("2026-09-18T06:00:00.000Z").toISOString(), "2026-09-18T18:00:00.000Z");
  assert.ok(onTheMark(chainNextClose("2026-09-17T18:00:00.000Z").toISOString()),
    "one write must put the chain on the marks permanently, or it is a fifteen-minute patch that decays at the next close");
});

test("the chain from a :45 close stays on :45 forever — the defect, stated as a test", () => {
  let at = "2026-09-17T17:45:40.128Z";
  for (let i = 0; i < 6; i++) {
    at = chainNextClose(at).toISOString();
    assert.equal(onTheMark(at), false,
      `after ${i + 1} crossing(s) the chain reached ${at}, which is on a mark — if this ever passes, the timer move alone was enough and this tool is unnecessary`);
  }
  assert.equal(at, "2026-09-20T17:45:40.128Z", "three days on, still :45:40 — a timer at :00 would have closed six windows late");
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("the plan names the window, both instants, the delta and what the chain will do", () => {
  const p = reanchorPlan(OPEN_WINDOW);
  assert.equal(p.ok, true);
  assert.equal(p.id, 189);
  assert.equal(p.from, "2026-09-17T17:45:40.128Z");
  assert.equal(p.to, "2026-09-17T18:00:00.000Z");
  assert.equal(p.already, false);
  assert.equal(p.moves_ms, 14 * 60_000 + 19_872, "the box's boundary rides at :45:40, so the move is 14m20s — not the fifteen minutes the timer's marks suggest");
  assert.equal(p.chain_next_close, "2026-09-18T06:00:00.000Z");
});

test("a window already on the mark plans no move", () => {
  const p = reanchorPlan({ id: 190, closes_at: "2026-09-18T06:00:00.000Z" });
  assert.equal(p.already, true);
  assert.equal(p.from, p.to);
  assert.equal(p.moves_ms, 0);
});

// ── the run: what SQL actually leaves the tool ───────────────────────────────

test("--dry-run writes nothing at all: one SELECT, no UPDATE", async () => {
  const store = recordingStore([OPEN_WINDOW]);
  const cap = capturing();
  assert.equal(await main(["--dry-run"], { query: store.query, ...cap.io }), 0);
  assert.equal(store.calls.length, 1, `a dry run sent ${store.calls.length} statement(s): ${store.calls.map((c) => c.sql).join(" | ")}`);
  assert.match(store.calls[0].sql, /^SELECT id, opens_at, closes_at FROM windows WHERE status = 'open'/);
  assert.equal(store.calls.filter((c) => /UPDATE/i.test(c.sql)).length, 0, "a dry run that writes is not a dry run");
  assert.ok(cap.out.some((l) => l.includes("2026-09-17T18:00:00.000Z")), "the plan must print the mark it would move to");
  assert.ok(cap.out.some((l) => l.includes("dry run")));
});

test("--apply moves exactly ONE row's closes_at, to the mark, and says what the chain owes", async () => {
  process.env.WINDOW_REANCHOR = "1";
  try {
    const store = recordingStore([OPEN_WINDOW], [{ id: 189, closes_at: "2026-09-17T18:00:00.000Z" }]);
    const cap = capturing();
    assert.equal(await main(["--apply"], { query: store.query, ...cap.io }), 0);
    const writes = store.calls.filter((c) => /UPDATE/i.test(c.sql));
    assert.equal(writes.length, 1, "one row, once");
    assert.match(writes[0].sql, /^UPDATE windows SET closes_at = \$1 WHERE id = \$2 AND closes_at = \$3 AND status = 'open'/,
      "the id AND the expected old value are both in the WHERE, so a store that moved under us updates nothing rather than the wrong thing");
    assert.deepEqual(writes[0].params, ["2026-09-17T18:00:00.000Z", 189, "2026-09-17T17:45:40.128Z"]);
    assert.ok(cap.out.some((l) => l.includes("RE-ANCHORED window 189")));
    assert.ok(cap.out.some((l) => l.includes("2026-09-18T06:00:00.000Z")),
      "the receipt must name what the next window owes, or nobody can check the write worked");
  } finally { delete process.env.WINDOW_REANCHOR; }
});

test("a SECOND apply refuses to move anything — the row is already on the mark", async () => {
  process.env.WINDOW_REANCHOR = "1";
  try {
    const store = recordingStore([{ id: 189, closes_at: "2026-09-17T18:00:00.000Z" }]);
    const cap = capturing();
    assert.equal(await main(["--apply"], { query: store.query, ...cap.io }), 0);
    assert.equal(store.calls.filter((c) => /UPDATE/i.test(c.sql)).length, 0,
      "a second apply must send no write at all — the guard is the VALUE in the store, which is the only thing a hand-typed one-shot can rely on");
    assert.ok(cap.out.some((l) => l.includes("already on the law's mark")));
  } finally { delete process.env.WINDOW_REANCHOR; }
});

test("an apply whose row moved under it writes nothing and says so", async () => {
  process.env.WINDOW_REANCHOR = "1";
  try {
    const store = recordingStore([OPEN_WINDOW], []); // UPDATE matches zero rows
    const cap = capturing();
    assert.equal(await main(["--apply"], { query: store.query, ...cap.io }), 1);
    assert.ok(cap.errs.some((l) => /matched 0 row\(s\)/.test(l)), cap.errs.join("\n"));
    assert.ok(cap.errs.some((l) => /nothing was written/.test(l)));
  } finally { delete process.env.WINDOW_REANCHOR; }
});

// ── the consent key ──────────────────────────────────────────────────────────

test("--apply without WINDOW_REANCHOR=1 refuses before it reads the store", async () => {
  delete process.env.WINDOW_REANCHOR;
  const store = recordingStore([OPEN_WINDOW]);
  const cap = capturing();
  assert.equal(await main(["--apply"], { query: store.query, ...cap.io }), 1);
  assert.equal(store.calls.length, 0, "the refusal must come before any store read, so a run with no consent touches nothing");
  assert.ok(cap.errs.some((l) => l.includes("WINDOW_REANCHOR=1")), "the refusal must name the key, or an operator cannot act on it");
});

test("the consent key is exact — not truthy, not 'true', not 'yes'", async () => {
  for (const v of ["0", "true", "yes", "", "1 ", undefined]) {
    if (v === undefined) delete process.env.WINDOW_REANCHOR; else process.env.WINDOW_REANCHOR = v;
    assert.equal(reanchorConsented(), false, `WINDOW_REANCHOR=${JSON.stringify(v)} must not consent`);
  }
  process.env.WINDOW_REANCHOR = "1";
  assert.equal(reanchorConsented(), true);
  delete process.env.WINDOW_REANCHOR;
});

test("--dry-run needs no consent at all — the rehearsal path must be free", async () => {
  delete process.env.WINDOW_REANCHOR;
  const store = recordingStore([OPEN_WINDOW]);
  assert.equal(await main(["--dry-run"], { query: store.query, ...quiet }), 0);
  assert.equal(store.calls.length, 1);
});

test("neither flag, or both, is a usage refusal that touches nothing", async () => {
  const a = recordingStore([OPEN_WINDOW]);
  assert.equal(await main([], { query: a.query, ...quiet }), 2);
  const b = recordingStore([OPEN_WINDOW]);
  process.env.WINDOW_REANCHOR = "1";
  try { assert.equal(await main(["--dry-run", "--apply"], { query: b.query, ...quiet }), 2); }
  finally { delete process.env.WINDOW_REANCHOR; }
  assert.equal(a.calls.length + b.calls.length, 0);
});

test("it refuses to choose between windows, and refuses when none is open", async () => {
  const two = recordingStore([OPEN_WINDOW, { id: 190, closes_at: "2026-09-18T05:45:40Z" }]);
  const cap = capturing();
  assert.equal(await main(["--dry-run"], { query: two.query, ...cap.io }), 1);
  assert.ok(cap.errs.some((l) => /expected exactly one open window, the store has 2 \(189, 190\)/.test(l)), cap.errs.join("\n"));

  const none = recordingStore([]);
  const cap2 = capturing();
  assert.equal(await main(["--dry-run"], { query: none.query, ...cap2.io }), 1);
  assert.ok(cap2.errs.some((l) => /the store has 0/.test(l)));
});

// ── the timers, and the words: text pins, the only instrument for a unit file ─

test("both timers carry the law's marks, and nothing else", () => {
  for (const f of ["deploy/postmark-settlement.timer", "deploy/postmark-world2-clearing.timer"]) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const marks = [...s.matchAll(/^OnCalendar=.*?(\d{2}:\d{2}:\d{2}) UTC\s*$/gm)].map((m) => m[1]);
    assert.deepEqual(marks, ["06:00:00", "18:00:00"],
      `${f} must carry the law's two marks (world LOGOS/classes.md § crossing ②, amended 2026-09-17 by postmark-world#96) — the repo copy is the live truth, and a timer that disagrees with the law is the whole of #2801`);
    assert.doesNotMatch(s, /OnCalendar=.*(05:45|17:45)/,
      `${f} still schedules on an old mark`);
    // ⚑ THE CITATION IS PINNED TOO, and it is not pedantry: the first cut of
    // this lane cited `census.md Decision 3` everywhere. That is the
    // postmark-world-2 gold plan — signed 2026-08-28, kept in Starstory PULSE,
    // ABSENT from the world tree, and its Decision 3 still reads 05:45Z / 17:45Z
    // unamended. So the unit files pointed at a document that (a) nobody holding
    // the world can open and (b) contradicts the marks beside the citation. A
    // wrong pointer to law reads exactly like a right one until someone follows
    // it, which is why it is worth a falsifier rather than care.
    assert.doesNotMatch(s, /census/i,
      `${f} cites census.md — the cadence's law line is world LOGOS/classes.md § crossing ②; census.md is a PULSE gold plan, not in the world tree, and still says 05:45/17:45`);
    assert.match(s, /classes\.md/,
      `${f} must name the law line its marks come from`);
  }
});

test("no LIVE sentence in the clearing or settlement scripts still says :45", () => {
  // Dated incident records KEEP their marks — "163 closed 09-02 05:45Z" is what
  // happened, and truing it would be a lie about the past. What must not survive
  // is a present-tense claim about where the candle sits.
  const clearing = readFileSync(new URL("../deploy/world2-clearing.sh", import.meta.url), "utf8");
  // The § LAW block, unwrapped, so a line break cannot pass or fail this.
  const lawBlock = clearing.split("# LAW (world main,")[1].split("\n#\n")[0].replace(/\n# /g, " ");
  assert.match(lawBlock, /windows close 06:00Z and\s+18:00Z from the w39 ship/,
    `world2-clearing.sh § LAW must state the amended marks; it reads: ${JSON.stringify(lawBlock)}`);
  assert.match(lawBlock, /LOGOS\/classes\.md § crossing ②/,
    "§ LAW must cite the line on world main that actually carries the cadence");
  assert.doesNotMatch(lawBlock, /census/i,
    "§ LAW cites census.md — a gold plan in Starstory PULSE, absent from the world tree, still reading 05:45Z / 17:45Z");
  assert.match(clearing.replace(/-\n# /g, "-"), /window-reanchor\.mjs/,
    "the script that cannot move its own chain must name the tool that can");
  const shadow = readFileSync(new URL("../deploy/postmark-settlement-shadow.timer", import.meta.url), "utf8");
  assert.match(shadow, /06:00\/18:00 marks/, "the shadow's reason for :23 is that it is off the REAL marks — naming the old ones makes the reason unreadable");
});

test("the chaining rule itself is untouched — this tool moves a row, never the law", () => {
  const job = readFileSync(new URL("../world2/tools/clearing-job.mjs", import.meta.url), "utf8");
  assert.match(job, /VALUES \(\$1, \$2, \$2::timestamptz \+ interval '12 hours', 'open'\)/,
    "the `+ 12 hours` chain is a STOP condition for this lane: the tool moves one row once and the chain carries it");
  // Comment lines are stripped first: this file's own header QUOTES the INSERT
  // above so a reader can see the rule it is not changing, and a scan that
  // cannot tell a quotation from a statement would have banned the explanation.
  const code = readFileSync(new URL("../world2/tools/window-reanchor.mjs", import.meta.url), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(code, /INSERT INTO|DELETE FROM|DROP |TRUNCATE /i,
    "this tool may write exactly one column on one row and nothing else");
  const updates = [...code.matchAll(/UPDATE\s+\w+\s+SET/gi)];
  assert.equal(updates.length, 1, `the tool issues ${updates.length} UPDATE statement(s); it may issue exactly one`);
  assert.match(code, /UPDATE windows SET closes_at = \$1 WHERE id = \$2 AND closes_at = \$3 AND status = 'open'/,
    "the one write is closes_at, guarded by the id, the expected old value and the open status");
});
