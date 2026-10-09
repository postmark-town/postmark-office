// world2-replay-ingest.test.mjs — the replay-parity gate's derivation, without a database.
//
// Everything `replay-ingest.mjs` DECIDES before it opens a connection —which
// settlements are eras, which acts belong to an era, which register changes are
// CLAIMS and which are the world moving under a mark that nobody touched — is
// pure with respect to the checkouts. So the tests build a world repo: a real git
// repo with real tagged commits, a `tools/marks-fold.mjs` the deriver imports out
// of it, and the files it reads at each tag. That is not a mock of the seam — it
// IS the seam ("the code that parses sha X is the code that shipped at sha X"),
// exercised with a reader small enough to reason about. Same technique, and the
// same reason, as test/world2-seed-import.test.mjs.
//
// The DB half — the ingest, the real clearing job's refusals, the parity verdict —
// is proved on the box, and its can-fail proof is `--can-fail-proof` there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  erasBetween, commitOf, eraActs, eraClaims, eraWindow, authoredSubstance,
  sixCountOf, amendId, assertReplayable, logCensus, doorWitness, SUBSTANCE_COLUMNS, windowFindings,
  standingOnly, actObject, isWithdrawAct, eraReceipt, dataFindings,
} from "../world2/tools/replay-ingest.mjs";
import { uuid5, deriveActs, LOG_FILE, compareMarks } from "../world2/tools/seed-import.mjs";
import { removeTempDirSync } from "./helpers/temp-dir.mjs";

// ── the fixture world ────────────────────────────────────────────────────────
//
// The register the fake `loadMarks` returns is switched by a file the fixture
// writes into the checkout (`WORLD/register.json`), so each tagged commit can
// carry a different world while the READER stays one piece of code — which is
// what a real settlement is: the same loader, a different tree.

const FIXTURE_READER = `
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function fold({ marks, households }) {
  // The real fold decides standing by walking the world. This one is enough to
  // carry the property the replay cares about: a mark's tier can change because
  // ANOTHER mark appeared, with no byte of its own record touched.
  const parcels = marks.filter((m) => m.kind === "parcel");
  return {
    marks: marks.map((m) => ({
      id: m.id,
      tier: parcels.some((p) => p.by === m.by && p.id !== m.id) ? "home" : "market",
      declared_household: households?.[m.by] ?? ("solo:" + m.by),
    })),
  };
}

export function loadMarks(marksDir) {
  const repo = dirname(dirname(marksDir));
  const recs = JSON.parse(readFileSync(join(repo, "WORLD", "register.json"), "utf8"));
  // \`_dir\` IS PART OF THE LOADER'S CONTRACT, and since DEC-15 the replay reads it:
  // a retirement has to name the FILE that left, and a mark's slug is not its path
  // (\`the-town/pledges\` is filed four directories deep under let-there-be-light).
  // The real loader states it at marks-fold.mjs § walkMarks — \`rec._dir = nodeDir\` —
  // so this reader states it too, or the fixture would be modelling a seam the
  // shipped loader does not have.
  return recs.map((r) => ({ ...r, _dir: join(marksDir, ...(r.dir ?? r.by + "/" + r.slug).split("/")) }));
}
`;

const M = (over) => ({
  id: `${over.by}/${over.slug}`, kind: "sited", body: "A thing.", date: "2026-07-01",
  at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, ...over,
});

/**
 * A world repo with one commit per settlement, each annotated-tagged.
 * `steps` is [{ tag, subject, register, log, at }].
 */
function world(steps) {
  const dir = mkdtempSync(join(tmpdir(), "w2replay-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  mkdirSync(join(dir, "STATE", "log"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), FIXTURE_READER);
  // git does not track an empty directory, and `deriveSeed` refuses a checkout
  // with no WORLD/marks — rightly, since that is not a world. The fixture's
  // register lives in register.json (the reader above reads it), so one file is
  // all the directory needs to survive a checkout.
  writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
  writeFileSync(join(dir, "WORLD", "households.json"), JSON.stringify({ households: { wren: "gh:1" } }));

  const g = (env, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env }).trim();
  const base = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  g(base, "init", "-q");

  const tags = {};
  for (const s of steps) {
    writeFileSync(join(dir, "WORLD", "register.json"), JSON.stringify(s.register ?? []));
    // THE REGISTER'S FILING, WRITTEN AS FILES. The reader above still answers out
    // of register.json — one piece of code across every tag, which is the whole
    // fixture technique — but DEC-15 asks git a question the register cannot
    // answer: WHICH COMMIT removed the record. That only means anything if the
    // record is a file a commit can remove. So the tree is rebuilt each step, and
    // a mark that leaves the register leaves a real deletion behind it.
    rmSync(join(dir, "WORLD", "marks"), { recursive: true, force: true });
    mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
    // `files` writes a mark file the register does NOT carry — the one case where
    // the tree and the settlement's outcome are allowed to disagree, which is what
    // the "still UNRULED" falsifier is about.
    for (const m of [...(s.register ?? []), ...(s.files ?? [])]) {
      const nodeDir = join(dir, "WORLD", "marks", ...(m.dir ?? `${m.by}/${m.slug}`).split("/"));
      mkdirSync(nodeDir, { recursive: true });
      writeFileSync(join(nodeDir, "mark.md"), `---\nkind: ${m.kind}\nby: ${m.by}\n---\n\n${m.body ?? ""}\n`);
    }
    for (const [name, lines] of Object.entries(s.log ?? {})) {
      writeFileSync(join(dir, "STATE", "log", name),
        (lines ?? []).map((l) => JSON.stringify(l)).join("\n"));
      const n = Number(LOG_FILE.exec(name)?.[1]);
      if (Number.isFinite(n) && Number.isInteger(n)) {
        writeFileSync(join(dir, "STATE", "log", `${n}.meta.json`),
          JSON.stringify({ crossing: n, covers_from: "2026-08-26T00:00:00.000Z" }));
      }
    }
    const env = { ...base, GIT_AUTHOR_DATE: s.at, GIT_COMMITTER_DATE: s.at };
    g(env, "add", "-A");
    g(env, "commit", "-qm", s.subject);
    if (s.tag) { g(env, "tag", "-a", s.tag, "-m", `annotated ${s.tag}`); tags[s.tag] = g(env, "rev-parse", "HEAD"); }
  }
  return { dir, tags, cleanup: () => removeTempDirSync(dir) };
}

// The two shapes the town's log actually carries, and they are NOT the same.
//   `ev`  the walk lane's rows — a `departure` nests its own fields under
//         `payload` (that is where `deriveActs` reads `crossing` from).
//   `pen` the door's rows — a `leave-mark` or a `withdraw` states `class` and
//         `object` at the TOP LEVEL, verbatim from the real log:
//         {"at":…,"type":"withdraw","actor":"neth","class":"mark","object":"neth/test-verify",…}
// DEC-15's case (a) reads `object`, so a fixture that only had `ev` could not
// state a withdrawal the way the town does.
const ev = (type, at, actor, over = {}) => ({ type, at, actor, payload: { ...over } });
const pen = (type, at, actor, object, over = {}) => ({ type, at, actor, class: "mark", object, ...over });

// A three-settlement world: nothing published in the first era, one mark added
// and one amended in the second, and a third mark whose tier moves because a
// PARCEL landed beside it.
const THREE = () => world([
  {
    tag: "settlement/S1", subject: "settlement: sweep 0 published, 0 unpublished",
    at: "2026-08-26T05:45:16+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [ev("departure", "2026-08-26T01:00:00.000Z", "wren")] },
  },
  {
    tag: "settlement/S2", subject: "crossing-save 8: 2 entities, 1 events",
    at: "2026-08-26T12:02:15+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: {
      "7.jsonl": [ev("departure", "2026-08-26T01:00:00.000Z", "wren"), ev("emission", "2026-08-26T02:00:00.000Z", "wren")],
      "8.jsonl": [],
    },
  },
  {
    tag: "settlement/S3", subject: "settlement: sweep 3 published, 0 unpublished, 4 left drafted, 0 withdrawn, 0 quarantined, 1 dropped",
    at: "2026-08-27T03:50:47+00:00",
    register: [
      M({ by: "wren", slug: "the-shed", body: "A rebuilt thing." }),   // amended
      M({ by: "wren", slug: "the-lamp" }),                             // untouched — tier moves anyway
      M({ by: "wren", slug: "the-yard", kind: "parcel" }),             // added (and the cause)
      M({ by: "stranger", slug: "the-rock" }),                         // added
    ],
    log: {
      "8.jsonl": [ev("departure", "2026-08-26T13:00:00.000Z", "wren")],
      "8.5.journal.jsonl": [ev("emission", "2026-08-26T14:00:00.000Z", "wren")],
      "9.jsonl": [],
    },
  },
]);

// ── the eras ─────────────────────────────────────────────────────────────────

test("an annotated tag resolves to its COMMIT, not to the tag object", () => {
  const w = THREE();
  try {
    const commit = commitOf(w.dir, "settlement/S2");
    const object = execFileSync("git", ["-C", w.dir, "rev-parse", "settlement/S2"], { encoding: "utf8" }).trim();
    assert.notEqual(commit, object, "the fixture's tags must be annotated for this to mean anything");
    assert.equal(commit, w.tags["settlement/S2"]);
  } finally { w.cleanup(); }
});

test("F-5 reading 3: a crossing-save closes a window with NO sweep — an era, and not a six-count of 0", () => {
  const w = THREE();
  try {
    // S2's subject is `crossing-save 8: …`. It published nothing, and under the
    // TAG model it was an era whose receipt read "UNCHECKABLE — not on a
    // settlement commit". It is still an era, because the town's clock moved and
    // the store must clear that candle — but it is a NO SWEEP era now, which is a
    // different statement from "a sweep published 0" and prints as one.
    const eras = erasBetween(w.dir, "settlement/S1", "settlement/S3");
    assert.deepEqual(eras.map((e) => [e.from.tag, e.to.tag]),
      [["settlement/S1", "settlement/S2"], ["settlement/S2", "settlement/S3"]]);
    assert.equal(eras[0].publishes.length, 0, "the crossing-save's window held no sweep");
    assert.equal(eraReceipt({ publishes: eras[0].publishes, derived: 0 }).noSweep, true);
    assert.equal(eras[1].publishes.length, 1, "and the sweep after it is its own window's era");
    assert.equal(eraReceipt({ publishes: eras[1].publishes, derived: 3 }).ok, true);
  } finally { w.cleanup(); }
});

// ── F-5: the era is a publish, and the windows must walk the clock ───────────
//
// The receipt that opened this lane: between settlement/S50 and settlement/S51
// the world carries SEVEN `settlement: sweep …` commits. The Worldkeeper mints a
// tag when his judgment lands; the box publishes at every crossing and on demand
// in between. Pairing tags made one era out of seven publishes.

const SWEEP = (n) => `settlement: sweep ${n} published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped`;

/** Two publishes between two tags, the middle one UNTAGGED, one window each. */
const TWO_PUBLISHES = () => world([
  { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T06:00:00+00:00",              // no tag — the box published anyway
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { tag: "b", subject: SWEEP(1), at: "2026-08-26T18:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
]);

test("F-5: two publishes in two WINDOWS are two eras, contiguous, each with its own six-count", async () => {
  const w = TWO_PUBLISHES();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2, "the untagged publish opened a new window — a tag is judgment, a window is an era");
    assert.equal(eras[0].from.tag, "a");
    assert.match(eras[0].to.tag, /^window\//, "an untagged boundary is named for the window it closed");
    assert.equal(eras[1].to.tag, "b");
    assert.equal(eras[1].from.sha, eras[0].to.sha, "the eras are contiguous — no commit falls between them");
    // The split came from the LOG, not from a `crossing-save` subject: this
    // fixture has none, and a segmentation that trusted subjects alone would
    // have collapsed both publishes into one era and said nothing about it.
    assert.equal(eras[0].statedWindow, null);

    // Each era's window is its OWN publish's clock, and they count.
    const withWindows = [];
    for (const e of eras) {
      const c = checkout(w.dir, e.to.sha);
      try { withWindows.push({ ...e, window: eraWindow({ toDir: c.dir, lawSha: e.to.sha, townSha: null }) }); }
      finally { c.dispose(); }
    }
    assert.deepEqual(withWindows.map((e) => e.window.id), [8, 9]);
    assert.deepEqual(windowFindings(withWindows), [], "contiguous windows are no finding at all");

    // And each holds itself to its OWN receipt, not the tag's.
    for (const e of withWindows) assert.equal(sixCountOf(e.to.subject).published, 1);
  } finally { w.cleanup(); }
});

test("F-5: a retirement in the FIRST of two windows files at THAT window, not the tag's", async () => {
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    { subject: SWEEP(0), at: "2026-08-26T06:00:00+00:00",            // the shed leaves HERE, at window 8
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2);
    const c = await claimsForShas(w, eras[0]);
    assert.equal(c.retired.length, 1, "the retirement belongs to the era it happened in");
    assert.equal(c.retired[0].slug, "wren/the-shed");
    // THE POINT OF THE LANE: the synthesised act carries window 8, the crossing
    // it happened at. Under the tag model it would have filed at 9 — the tag's.
    assert.equal(c.retired[0].synthesised.crossing, 8);

    const later = await claimsForShas(w, eras[1]);
    assert.equal(later.retired.length, 0, "and it does not happen twice");
  } finally { w.cleanup(); }
});

// ── F-5 reading 3: the era is the WINDOW, derived as a run of publishes ──────
//
// A publish is not a crossing. The town commits `crossing-save <N>` when its
// clock advances and NAMES the window; sweeps publish into whichever window is
// open, and several may run inside one — five did on 2026-09-01, between 14:07
// and 17:45, all inside window 163. The store's unit is the window (one row per
// crossing, one candle cleared at a time), so the era is the window and the
// publishes inside it are a run.

/** One window holding two sweeps, then a window holding none. */
const TWO_SWEEPS_ONE_WINDOW = () => world([
  { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
  { subject: "crossing-save 8: 2 entities, 1 events", at: "2026-08-26T06:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [], "8.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T07:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T08:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { tag: "b", subject: "crossing-save 9: 3 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
]);

test("F-5 reading 3: two sweeps inside one window are ONE era, held to the SUM of their six-counts", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2, "one era per WINDOW — not one per sweep, and not one per tag");

    const [first] = eras;
    assert.equal(first.statedWindow, 8, "the town names its own window in the crossing-save subject");
    assert.equal(first.publishes.length, 2, "both sweeps ran inside window 8 and belong to its era");

    // The era's claim set is the WHOLE-WINDOW diff, one row per slug — not the
    // union of per-sweep sets. It has to be: `amendId(slug, window)` is derived
    // from the slug and the window, so two amends of one slug in one window would
    // collide on the claims primary key.
    const c = await claimsForShas(w, first);
    assert.deepEqual(c.claims.map((x) => x.slug).sort(), ["wren/the-lamp", "wren/the-yard"]);

    const r = eraReceipt({ publishes: first.publishes, derived: c.claims.length });
    assert.equal(r.checked, true);
    assert.equal(r.ok, true, "1 + 1 = 2, and the era derives 2");
    assert.equal(r.six.published, 2, "the SUM is what the window is judged on");
    assert.equal(r.sweeps, 2, "and the count of sweeps is reported, so a sum is never mistaken for one receipt");

    // The sum alone would be a weaker check than the one it replaces — 5+1+1+1+1
    // and a single 9 both total nine. Each sweep keeps its own count.
    assert.deepEqual(first.publishes.map((p) => sixCountOf(p.subject).published), [1, 1]);
  } finally { w.cleanup(); }
});

test("F-5 reading 3: a window with NO sweep is an era of its own, and its receipt says 'no sweep', not 0", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const second = erasBetween(w.dir, "a", "b")[1];
    assert.equal(second.statedWindow, 9);
    assert.equal(second.publishes.length, 0);

    const c = await claimsForShas(w, second);
    assert.deepEqual(c.claims, [], "the crossing closed with the register unchanged");

    const r = eraReceipt({ publishes: second.publishes, derived: 0 });
    assert.equal(r.noSweep, true);
    assert.equal(r.checked, false, "'no sweep ran' and 'a sweep published 0' are different statements");
    assert.equal(r.ok, undefined, "so it must not read as a passing receipt either");
    assert.match(r.why, /no sweep ran/);
  } finally { w.cleanup(); }
});

test("F-5 reading 3: the windows walk the clock one at a time, so nothing is left for the store to refuse", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    const withWindows = [];
    for (const e of eras) {
      const c = checkout(w.dir, e.to.sha);
      try { withWindows.push({ ...e, window: eraWindow({ toDir: c.dir, lawSha: e.to.sha, townSha: null }) }); }
      finally { c.dispose(); }
    }
    assert.deepEqual(withWindows.map((e) => e.window.id), [8, 9]);
    // The town's stated number and the log rule are two readings of one fact.
    for (const e of withWindows) assert.equal(e.window.id, e.statedWindow, "the subject and the log must agree");
    assert.deepEqual(windowFindings(withWindows), []);
  } finally { w.cleanup(); }
});

// ── §9: a window begins where its log file does, in EITHER form ──────────────
//
// The town has no `crossing-save 154`. `154.jsonl` was not written until
// `c701988f9` (crossing-save 155), hours after the window had elapsed — so a
// scan of the highest INTEGER log saw the clock go 153 → 155 and reported a hole,
// and two sweeps that published inside 154 were filed under 153. The `.journal`
// form does not lag: a drain wrote `154.journal.jsonl` at 06:05Z that morning,
// inside window 154's own declared span. The boundary is the first commit to name
// the window in EITHER form.

test("§9: a window named only by its `.journal` log still gets an era, and the ruled number beats the lagging integer", () => {
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
    // The drain: window 8 exists and only the journal form says so. The highest
    // integer log here is still 7 — this is the real `a31796fac` shape.
    { subject: "drain: journal windows 7, 7.66, 8", at: "2026-08-26T06:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.journal.jsonl": [] } },
    { tag: "b", subject: "crossing-save 9: 1 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.journal.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.deepEqual(eras.map((e) => e.window), [8, 9], "the clock counts 8 then 9 — no hole where a save was missed");
    assert.match(eras[0].to.tag, /^window\/8$/);

    // The ruled number and the integer scan DISAGREE here, which is the finding.
    // `eraWindow` reads the highest integer log and still says 7.
    const c = checkout(w.dir, eras[0].to.sha);
    try { assert.equal(eraWindow({ toDir: c.dir, lawSha: eras[0].to.sha, townSha: null }).id, 7,
      "the integer log lags, which is exactly why the rule does not use it alone"); }
    finally { c.dispose(); }

    assert.deepEqual(windowFindings(eras.map((e) => ({ ...e, window: { id: e.window } }))), [],
      "and with the journal form read, the clock has no gap to report");
  } finally { w.cleanup(); }
});

test("§9: one commit naming TWO windows gives two eras, and the first closes where it opens", () => {
  // `c701988f9` wrote a completed window's log and the newly opened one's in the
  // same commit. No tree ever stood between them, so the earlier era is real and
  // empty — the store gets its candle without a world being invented to fill it.
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
    { tag: "b", subject: "crossing-save 9: 1 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.deepEqual(eras.map((e) => e.window), [8, 9], "both windows get a candle, in order");
    assert.equal(eras[0].to.sha, eras[1].to.sha, "one commit closed both, so they end at the same tree");
    assert.deepEqual(eras[0].foldedWith, [8, 9], "and the era says so rather than pretending it stood alone");
  } finally { w.cleanup(); }
});

test("F-5: a window with no publish behind it, and a publish that closed no window, are both NAMED", () => {
  const era = (id, tag) => ({ to: { tag }, window: { id } });
  const skipped = windowFindings([era(153, "p1"), era(155, "p2")]);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].kind, "skipped");
  assert.deepEqual(skipped[0].missing, [154]);
  assert.match(skipped[0].text, /closed with no publish behind them/);

  const same = windowFindings([era(163, "p1"), era(163, "p2")]);
  assert.equal(same[0].kind, "same");
  assert.match(same[0].text, /closed no window/);

  // The town's clock does not run backwards, and a sequence that says it does is
  // its own finding rather than a very large skip.
  assert.equal(windowFindings([era(164, "p1"), era(163, "p2")])[0].kind, "backwards");

  assert.deepEqual(windowFindings([era(160, "p1"), era(161, "p2"), era(162, "p3")]), [],
    "the shape the store expects: one window at a time");
});

test("a range with no settlement between its ends has nothing to replay, and says so", () => {
  const w = THREE();
  try {
    assert.throws(() => erasBetween(w.dir, "settlement/S1", "settlement/S1"), /same commit|nothing to replay/);
  } finally { w.cleanup(); }
});

// ── the acts ─────────────────────────────────────────────────────────────────

test("the era's acts are rows appended to a log file that ALREADY EXISTED, not just new files", () => {
  const w = THREE();
  try {
    const a = checkout(w.dir, w.tags["settlement/S1"]), b = checkout(w.dir, w.tags["settlement/S2"]);
    try {
      const era = eraActs({ fromDir: a.dir, toDir: b.dir });
      // `8.jsonl` is new and empty; the era's one act is the emission appended to `7.jsonl`.
      assert.equal(era.rows.length, 1);
      assert.equal(era.rows[0].action, "legacy:emission");
      assert.equal(era.vanished.length, 0);
    } finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a repeated log row counts twice — the difference is a MULTISET, so a dropped copy cannot hide", () => {
  const line = ev("departure", "2026-08-08T18:00:00.000Z", "rook");
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [], log: { "7.jsonl": [line] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
      register: [], log: { "7.jsonl": [line, line, line] } },
  ]);
  try {
    const a = checkout(w.dir, w.tags.a), b = checkout(w.dir, w.tags.b);
    try { assert.equal(eraActs({ fromDir: a.dir, toDir: b.dir }).rows.length, 2); }
    finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a log row that was there and is gone is REPORTED — the log is append-only by law", () => {
  const keep = ev("departure", "2026-08-08T18:00:00.000Z", "rook");
  const lost = ev("emission", "2026-08-08T19:00:00.000Z", "rook");
  const w = world([
    { tag: "a", subject: "s", at: "2026-08-26T00:00:00+00:00", register: [], log: { "7.jsonl": [keep, lost] } },
    { tag: "b", subject: "s", at: "2026-08-26T01:00:00+00:00", register: [], log: { "7.jsonl": [keep] } },
  ]);
  try {
    const a = checkout(w.dir, w.tags.a), b = checkout(w.dir, w.tags.b);
    try {
      const era = eraActs({ fromDir: a.dir, toDir: b.dir });
      assert.equal(era.rows.length, 0);
      assert.equal(era.vanished.length, 1);
    } finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a FRACTIONAL .journal log file is read — the 08-27 hand-drain's four windows", () => {
  const w = THREE();
  try {
    const b = checkout(w.dir, w.tags["settlement/S3"]);
    try {
      const all = deriveActs({ worldRepo: b.dir });
      assert.ok(all.crossings.includes(8.5), `crossings ${all.crossings} should include the fractional 8.5`);
      // And it buckets to its integer window for the completeness check.
      assert.equal(logCensus(b.dir).get(8), 2);
    } finally { b.dispose(); }
  } finally { w.cleanup(); }
});

test("LOG_FILE takes every shape the town writes, and nothing else", () => {
  assert.equal(LOG_FILE.exec("153.jsonl")?.[1], "153");
  assert.equal(LOG_FILE.exec("153.journal.jsonl")?.[1], "153");
  assert.equal(LOG_FILE.exec("152.9084.journal.jsonl")?.[1], "152.9084");
  assert.equal(LOG_FILE.exec("153.meta.json"), null);
  assert.equal(LOG_FILE.exec("notes.jsonl"), null);
});

// ── the claims ───────────────────────────────────────────────────────────────

test("a mark whose only change is the FOLD's answer is not a claim (the le-petit-berthillon case)", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const slugs = c.claims.map((x) => x.slug).sort();
    // the-lamp's tier moves market -> home because wren/the-yard (a parcel) landed;
    // not a byte of the-lamp's own record changed, and nobody claimed on its behalf.
    assert.ok(!slugs.includes("wren/the-lamp"), `the-lamp must not be claimed; got ${slugs.join(", ")}`);
    assert.deepEqual(slugs, ["stranger/the-rock", "wren/the-shed", "wren/the-yard"]);
    assert.deepEqual(c.amended.map((x) => x.mark.slug), ["wren/the-shed"]);
  } finally { w.cleanup(); }
});

test("the derived claim count is held against the settlement's OWN six-count", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const six = sixCountOf("settlement: sweep 3 published, 0 unpublished, 4 left drafted, 0 withdrawn, 0 quarantined, 1 dropped");
    assert.equal(six.published, c.claims.length);
    assert.equal(six.left_drafted, 4);
    assert.equal(six.dropped, 1);
  } finally { w.cleanup(); }
});

test("a tag that is not on a settlement commit has NO six-count, and the receipt says so", () => {
  assert.equal(sixCountOf("crossing-save 151: 69 entities, 34 events"), null);
  // The short spelling — S47 and S49 both carry it — still yields the number that matters.
  assert.equal(sixCountOf("settlement: sweep 14 published, 0 unpublished").published, 14);
  assert.equal(sixCountOf("settlement: sweep 14 published, 0 unpublished").left_drafted, null);
});

test("an added mark's claim IS the mark's id; an amend carries supersedes and its own", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const yard = c.claims.find((x) => x.slug === "wren/the-yard");
    assert.equal(yard.id, uuid5("wren/the-yard"));
    assert.equal(yard.supersedes, null);
    assert.equal(yard.status, "pending");

    const shed = c.claims.find((x) => x.slug === "wren/the-shed");
    assert.equal(shed.supersedes, uuid5("wren/the-shed"), "an amend supersedes the standing mark's locking claim");
    assert.notEqual(shed.id, uuid5("wren/the-shed"), "and cannot reuse that id — it is a primary key");
    assert.equal(shed.id, amendId("wren/the-shed", 9));
  } finally { w.cleanup(); }
});

test("amendId is deterministic, and a different window gives a different claim", () => {
  assert.equal(amendId("wren/the-shed", 9), amendId("wren/the-shed", 9));
  assert.notEqual(amendId("wren/the-shed", 9), amendId("wren/the-shed", 10));
  assert.notEqual(amendId("wren/the-shed", 9), uuid5("wren/the-shed"));
});

// ── the retirement (DEC-15, 2026-09-04) ──────────────────────────────────────
//
// These three replace "a mark that LEAVES the register stops the replay", which
// passed for as long as it should have. Its refusal existed "so that the first
// one is seen"; it was seen on the S47 → S55 dry run, and DEC-15 is the ruling.
// The refusal has not gone — the third test below is it, standing over the
// departures DEC-15 does NOT rule on.

test("DEC-15 (b): a standing mark removed by a commit RETIRES, and the synthesised withdraw names that commit", async () => {
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    // A settlement advances the town's clock by one, and the era's window IS that
    // number — so the retirement has a window to be filed at.
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped",
      at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 1);
    assert.equal(c.unruled.length, 0, "a deleted record is exactly the transition DEC-15 rules on");

    const r = c.retired[0];
    assert.equal(r.slug, "wren/the-shed");
    assert.equal(r.case, "b");
    assert.equal(r.path, "WORLD/marks/wren/the-shed/mark.md", "the FILE that left, from the checkout's own loader");
    assert.equal(r.commit.sha, w.tags.b, "the commit that deleted the record is the hand behind the retirement");
    assert.equal(r.act, null, "no resident withdrew it, so the era's log carries nothing to find");

    // The act the founder's commit never wrote, written for it — "the record
    // leaves canon, its whole life stays in the log" (founder-ruled 08-19).
    const s = r.synthesised;
    assert.equal(s.actor, "the-town");
    assert.equal(s.class, "mark");
    assert.equal(s.object, "wren/the-shed");
    assert.equal(s.crossing, 8, "the era's window, so the act files where the retirement happened");
    assert.equal(s.at, r.commit.at, "written_at is when the commit landed — the act's own time, not now()");
    assert.equal(s.payload.retired_by, w.tags.b);
    assert.match(s.payload.subject, /sweep 0 published/);
    assert.match(s.payload._synthesised, /DEC-15/, "a row no door wrote must say so on its face");
    // Bare, not `legacy:` — `actsCompleteness` counts `legacy:%` against the
    // checkout's STATE/log census, and this row is in no log.
    assert.equal(s.action, "withdraw");

    // A retirement is not a claim and never enters the docket.
    assert.deepEqual(c.claims.map((x) => x.slug), []);
  } finally { w.cleanup(); }
});

test("DEC-15 (a): a removal the era's log already WITHDREW is that act, and synthesises nothing", async () => {
  const withdraw = pen("withdraw", "2026-08-26T00:30:00.000Z", "wren", "wren/the-shed");
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 1 withdrawn, 0 quarantined, 0 dropped",
      at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [withdraw] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 1);
    const r = c.retired[0];
    assert.equal(r.case, "a", "the log's own act is the retirement");
    assert.equal(r.synthesised, null, "and nothing may be invented beside it");
    assert.equal(r.commit, null, "the commit is not even looked up — the resident's hand is on the record");
    assert.equal(actObject(r.act), "wren/the-shed");
    assert.equal(r.act.action, "legacy:withdraw", "as `deriveActs` spells a row it read out of the log");

    // 1.0 COUNTED THIS ALL ALONG. The refusal this ruling replaced said the
    // six-count had no transition for a standing mark leaving; `withdrawn` is it.
    assert.equal(sixCountOf(
      "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 1 withdrawn, 0 quarantined, 0 dropped").withdrawn, 1);
  } finally { w.cleanup(); }
});

// ── the re-identification (DEC-16, ruled 2026-09-04) ─────────────────────────
//
// The id refold was UNRULED for one afternoon and refused S52. These are its
// successors. The refusal has not gone: the third test is the shape DEC-16 still
// does not cover, and it still stops the era.

// world 17103dc37, 2026-08-31: "the Lit Name passes to wright … restake on
// wright/the-lit-name owed after the next crossing REFOLDS THE ID". One file,
// MODIFIED not deleted; `by` changed, and a mark's id is `by + leaf`.
const FILED = "wright/the-unlit-cake/the-lit-name";
const refold = (over = {}) => world([
  { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "the-town", slug: "the-lit-name", dir: FILED }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [] } },
  { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
    register: [M({ by: "wright", slug: "the-lit-name", dir: FILED, ...over }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
]);

test("DEC-16: a mark whose FILE stayed and whose `by` changed is a TRANSFER, not a retirement plus a claim", async () => {
  const w = refold();
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 0, "the record never left canon — nothing is retired");
    assert.equal(c.unruled.length, 0, "and nothing is unruled: DEC-16 is the reading");
    assert.equal(c.transferred.length, 1);

    const t = c.transferred[0];
    assert.equal(t.from_slug, "the-town/the-lit-name");
    assert.equal(t.to_slug, "wright/the-lit-name");
    assert.equal(t.path, `WORLD/marks/${FILED}/mark.md`, "the SAME file at both tags — that is the tell");
    assert.equal(t.commit.sha, w.tags.b, "the commit that changed hands, found by --diff-filter=M");
    assert.equal(t.amended, false, "only the identity moved, so the author claimed nothing");

    // THE SHARP END: the addition is NOT a claim. Left in, it would derive a
    // claim whose id is uuid5(new slug) and materialize a SECOND row under a slug
    // the transferred row is about to take.
    assert.deepEqual(c.claims.map((x) => x.slug), [], "nobody claimed this mark; it changed hands");
    assert.ok(!c.added.some((m) => m.slug === "wright/the-lit-name"), "the addition half is consumed by the transfer");

    const s = t.synthesised;
    assert.equal(s.action, "transfer", "bare, like the withdraw — `actsCompleteness` counts `legacy:%` only");
    assert.equal(s.actor, "the-town");
    assert.equal(s.class, "mark");
    assert.equal(s.object, "wright/the-lit-name", "acts.object is how a mark's history is found; the row is the new one now");
    assert.equal(s.crossing, 8);
    assert.equal(s.at, t.commit.at);
    assert.equal(s.payload.from_slug, "the-town/the-lit-name");
    assert.equal(s.payload.to_slug, "wright/the-lit-name");
    assert.equal(s.payload.retired_by, w.tags.b);
    assert.match(s.payload._synthesised, /DEC-16/);
  } finally { w.cleanup(); }
});

test("DEC-16: a transfer that ALSO edits the record carries ONE amend claim, under the new slug, superseding the OLD id", async () => {
  const w = refold({ body: "A rebuilt thing." });
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 1);
    assert.equal(c.transferred[0].amended, true, "`was` wearing the new owner no longer equals `now`");

    // ONE claim, not two: the transfer is not a claim, the edit is.
    assert.deepEqual(c.claims.map((x) => x.slug), ["wright/the-lit-name"]);
    const amend = c.claims[0];
    assert.equal(amend.id, amendId("wright/the-lit-name", 8), "the amend's own id is derived from the name it lands under");
    // THE ONE THAT WOULD HAVE BROKEN THE FK. `uuid5(new slug)` is a number no
    // claim in the store carries; the standing mark's locking claim is the OLD id.
    assert.equal(amend.supersedes, uuid5("the-town/the-lit-name"), "supersedes the STANDING mark's locking claim");
    assert.notEqual(amend.supersedes, uuid5("wright/the-lit-name"), "and NOT a re-derivation from the new slug");
    assert.equal(amend.body, "A rebuilt thing.");
    assert.equal(amend.claimant, "wright", "the claim is the new owner's — the record is his by the time it lands");
  } finally { w.cleanup(); }
});

test("an ordinary amend still supersedes its own id — the DEC-16 change is a no-op where the slug did not move", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const shed = c.claims.find((x) => x.slug === "wren/the-shed");
    assert.equal(shed.supersedes, uuid5("wren/the-shed"));
  } finally { w.cleanup(); }
});

test("a mark that leaves the register while its FILE stays put is still UNRULED — the refusal survives DEC-16", async () => {
  // Neither ruling covers this. Nothing withdrew it (no act), nothing deleted it
  // (the file is still on disk, unchanged), and nothing renamed it (no other id
  // stands at that path). The register and the tree simply disagree, and choosing
  // between two sources is not a transition a replay may write.
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "the-town", slug: "the-lit-name", dir: FILED }), M({ by: "wren", slug: "the-lamp" })],
      log: { "7.jsonl": [] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })],       // the register drops it …
      files: [{ dir: FILED, kind: "sited", by: "the-town", body: "A thing." }],   // … the file stays
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 0, "no other id stands at that path, so nothing changed hands");
    assert.equal(c.retired.filter((r) => r.case === "b").length, 0, "and no commit deleted it, so nothing retired");
    assert.equal(c.unruled.length, 1);
    assert.match(c.unruled[0].detail, /deletes|no file at that path/);
    assert.equal(c.unruled[0].synthesised, null, "an unruled departure writes nothing, ever");
  } finally { w.cleanup(); }
});

// NOT COVERED HERE, and stated rather than implied: `eraClaims` has a third
// unruled branch — the file stands under a NEW id that the settlement's register
// does not carry. This fixture's reader answers out of `register.json`, so the
// filing map and the register are derived from the same list and cannot disagree
// that way; only the shipped loader, which walks the tree, can produce it. The
// branch is reachable in production and unreachable here, and pretending
// otherwise would be a test that proves the fixture rather than the code.

test("authoredSubstance sees the author's hand and ignores the fold's", () => {
  const base = { kind: "sited", owner: "wren", household: "gh:1", body: "A thing.",
    geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(1,1))", parent: null, data: { date: "d", tier: "market" } };
  assert.equal(authoredSubstance(base), authoredSubstance({ ...base, data: { date: "d", tier: "home" } }));
  assert.equal(authoredSubstance(base), authoredSubstance({ ...base, household: "solo:wren" }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, body: "Another thing." }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, geometry: { at: { x: 1, y: 0 } } }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, data: { date: "e", tier: "market" } }));
});

// ── the window ───────────────────────────────────────────────────────────────

test("the era's window is the highest INTEGER crossing, undisturbed by fractional files", () => {
  const w = THREE();
  try {
    const b = checkout(w.dir, w.tags["settlement/S3"]);
    try {
      const win = eraWindow({ toDir: b.dir, lawSha: "SHA", townSha: null });
      assert.equal(win.id, 9);
      assert.equal(win.status, "open");
      assert.equal(win.law_sha, "SHA");
    } finally { b.dispose(); }
  } finally { w.cleanup(); }
});

// ── the refusal ──────────────────────────────────────────────────────────────

const eraStub = (id) => ({ window: { id } });

test("a store whose windows already closed refuses a second replay, and names --continue", () => {
  const state = { windows: [{ id: 150, status: "closed" }, { id: 151, status: "closed" }, { id: 152, status: "open" }] };
  assert.throws(() => assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: false }),
    /already closed|--continue/);
});

test("--continue verifies the closed eras rather than re-ingesting them", () => {
  const state = { windows: [{ id: 151, status: "closed" }, { id: 152, status: "open" }] };
  const skip = assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: true });
  assert.deepEqual([...skip], [151]);
});

test("a first run against the seeded floor is not a refusal", () => {
  const state = { windows: [{ id: 150, status: "closed" }, { id: 151, status: "open" }] };
  const skip = assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: false });
  assert.equal(skip.size, 0);
});

// ── the parity comparator, and that it can fail ──────────────────────────────

test("the parity comparator is the seed's own, and every substance column can turn it red", () => {
  const repo = [{ slug: "wren/the-shed", kind: "sited", owner: "wren", household: "gh:1",
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" }];
  const green = compareMarks(repo.map((r) => ({ ...r })), repo, { columns: SUBSTANCE_COLUMNS });
  assert.deepEqual(green, [], "identical sides must be green, or nothing below means anything");

  for (const [field, bad] of [
    ["kind", "parcel"], ["owner", "someone-else"], ["household", "solo:wren"],
    ["body", "Another thing."], ["status", "retired"],
  ]) {
    const db = [{ ...repo[0], [field]: bad }];
    const red = compareMarks(db, repo, { columns: SUBSTANCE_COLUMNS });
    assert.equal(red.length, 1, `mangling ${field} must turn the comparator red`);
    assert.match(red[0], new RegExp(`field ${field}`));
  }
  assert.match(compareMarks([{ ...repo[0], geometry: { at: { x: 9, y: 0 } } }], repo, { columns: SUBSTANCE_COLUMNS })[0], /field geometry/);
  assert.match(compareMarks([{ ...repo[0], bbox: "((0,0),(9,9))" }], repo, { columns: SUBSTANCE_COLUMNS })[0], /field bbox/);
  assert.match(compareMarks([], repo, { columns: SUBSTANCE_COLUMNS })[0], /MISSING in DB/);
  assert.match(compareMarks([...repo, { ...repo[0], slug: "forged/thing" }], repo, { columns: SUBSTANCE_COLUMNS })[0], /EXTRA in DB/);
});

test("DEC-15: the gate compares STANDING rows only — a retired store row reads as absent, both ways", () => {
  // 1.0's register is a set of files and a removed file leaves no row; 2.0 keeps
  // the row and flips `status`. The same register, said two ways.
  const standing = (slug) => ({ slug, kind: "sited", owner: "wren", household: "gh:1",
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" });
  const register = [standing("wren/the-lamp")];
  const store = [standing("wren/the-lamp"), { ...standing("wren/the-shed"), status: "retired" }];

  // GREEN: the retired row is not compared, so a lawful retirement is not a finding.
  assert.deepEqual(standingOnly(store).map((r) => r.slug), ["wren/the-lamp"]);
  assert.deepEqual(compareMarks(standingOnly(store), register, { columns: SUBSTANCE_COLUMNS }), [],
    "a retired row must not read as EXTRA — that would make the ruling its own red");

  // CAN-FAIL, direction 1: un-retire it and the gate must see a mark 1.0 never had.
  const unretired = store.map((r) => ({ ...r, status: "standing" }));
  assert.match(compareMarks(standingOnly(unretired), register, { columns: SUBSTANCE_COLUMNS })[0], /EXTRA in DB/,
    "the filter must classify rows, not hide them");

  // CAN-FAIL, direction 2: retire one the register STILL carries → MISSING in DB.
  const overRetired = [{ ...standing("wren/the-lamp"), status: "retired" }];
  assert.match(compareMarks(standingOnly(overRetired), register, { columns: SUBSTANCE_COLUMNS })[0], /MISSING in DB/,
    "a mark 1.0 still publishes may not be retired by the replay");
});

test("DEC-16: after a transfer the comparator needs no special case — and catches a half-applied one", () => {
  const row = (slug, owner) => ({ slug, kind: "sited", owner, household: `solo:${owner}`,
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" });

  // The register at S(k+1) carries the NEW name; so does the store row. The same
  // record, one name, and `compareMarks` keys on slug — nothing to special-case.
  const register = [row("wright/the-lit-name", "wright")];
  assert.deepEqual(compareMarks([row("wright/the-lit-name", "wright")], register, { columns: SUBSTANCE_COLUMNS }), [],
    "a completed transfer is simply agreement");

  // HALF-APPLIED, the shape `--can-fail-proof`'s un-transfer break provokes: the
  // slug did not move. Two findings, and both matter — the new name is missing
  // and the old one is a mark 1.0 no longer carries.
  const stuck = compareMarks([row("the-town/the-lit-name", "wright")], register, { columns: SUBSTANCE_COLUMNS });
  assert.equal(stuck.length, 2, `a stuck slug must be reported at both names; got ${stuck.join(" | ")}`);
  assert.ok(stuck.some((f) => /MISSING in DB: wright\/the-lit-name/.test(f)));
  assert.ok(stuck.some((f) => /EXTRA in DB.*the-town\/the-lit-name/.test(f)));

  // The other half-application: the slug moved, the owner did not. `owner` is a
  // substance column, so it is caught on its own.
  assert.match(compareMarks([row("wright/the-lit-name", "the-town")], register, { columns: SUBSTANCE_COLUMNS })[0],
    /field owner/);
});

// ── the admission (DEC-17, RULED 2026-09-04) ─────────────────────────────────
//
// The ruling, verbatim, and these four tests are its falsifier:
//
//   "A founder's hand on main is an ADMISSION in every face — an added mark
//    materialises directly (a claim LOCKED at that window by the founder's hand
//    naming the commit, the mark standing), an amended mark supersedes directly
//    (the same locked shape, `supersedes` the standing one), a removed mark
//    retires (DEC-15). The clearing job never re-judges canon. … Falsifier: a
//    fixture era with a hand-planted mark replays to a locked claim + standing
//    mark, receipt unchanged; mangling it to `pending` reddens the gate."
//
// The middle step of each world below is the founder's hand: a commit between
// the two tags whose subject is NOT a sweep, which is the entire test for
// "no door saw it and no sweep counted it" (`PUBLISH_SUBJECT`).

const HAND = "civic quarter: the law the five plaques used to say returns as predicated children";

/** a → (the founder's hand, or a sweep) → b. `subject` decides which. */
const planted = (subject, second) => world([
  { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
  { subject, at: "2026-08-26T00:30:00+00:00", register: second, log: { "7.jsonl": [] } },
  { tag: "b", subject: SWEEP(1), at: "2026-08-26T01:00:00+00:00",
    register: second, log: { "7.jsonl": [], "8.jsonl": [] } },
]);

test("DEC-17: a mark added by a NON-SWEEP commit is the founder's hand — a LOCKED claim naming that commit", async () => {
  const w = planted(HAND, [M({ by: "wren", slug: "the-lamp" }), M({ by: "the-town", slug: "the-bounty-board" })]);
  try {
    const c = await claimsFor(w, "a", "b");

    // The hand is found, and it rides beside `added` rather than on it — `added`
    // holds the very objects `registerAfter` returns, and that is the oracle.
    assert.equal(c.hand.length, 1);
    assert.equal(c.hand[0].slug, "the-town/the-bounty-board");
    assert.match(c.hand[0].subject, /civic quarter/);
    assert.ok(c.hand[0].at, "the commit's own time, which is what `decided_at` becomes");
    assert.deepEqual(c.handAmends, []);
    assert.equal(c.added.length, 1);
    assert.equal(c.added[0].hand, undefined, "the parity oracle's own mark objects stay unannotated");

    const claim = c.claims.find((x) => x.slug === "the-town/the-bounty-board");
    assert.equal(claim.status, "locked", "an admission is decided; the clearing job never re-judges canon");
    assert.equal(claim.decided_at, c.hand[0].at, "decided when the founder's commit landed, not at replay time");
    assert.equal(claim.data.locked_by, "founder");
    assert.equal(claim.data.founder_commit.sha, c.hand[0].sha);
    assert.match(claim.data.founder_commit.subject, /civic quarter/);
    assert.equal(claim.supersedes, null, "an addition supersedes nothing");
    assert.equal(claim.id, uuid5("the-town/the-bounty-board"),
      "and its id is still the mark's, so the materialised row's id is its first locking claim's");
  } finally { w.cleanup(); }
});

test("DEC-17: a mark AMENDED by the founder's hand is the same locked shape, and supersedes the standing one", async () => {
  const w = planted(HAND, [M({ by: "wren", slug: "the-lamp", body: "A rebuilt thing." })]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.deepEqual(c.hand, [], "nothing was added — this is the hand's second face");
    assert.equal(c.handAmends.length, 1);
    assert.equal(c.handAmends[0].slug, "wren/the-lamp");

    const claim = c.claims.find((x) => x.slug === "wren/the-lamp");
    assert.equal(claim.status, "locked");
    assert.equal(claim.decided_at, c.handAmends[0].at);
    assert.equal(claim.data.locked_by, "founder");
    assert.equal(claim.data.founder_commit.sha, c.handAmends[0].sha);
    assert.equal(claim.supersedes, uuid5("wren/the-lamp"), "supersedes the STANDING mark's locking claim");
    assert.equal(claim.id, amendId("wren/the-lamp", 8), "and carries its own amend id, as any amend does");
    // The record itself is untouched by the admission — only how it arrived.
    assert.equal(claim.body, "A rebuilt thing.");
  } finally { w.cleanup(); }
});

test("DEC-17: a mark added by a SWEEP commit stays a PENDING resident claim — the negative control", async () => {
  // The same world, the same shape, one thing different: the middle commit's
  // subject IS a sweep. Without this the two tests above would pass against a
  // pen that locked everything.
  const w = planted(SWEEP(1), [M({ by: "wren", slug: "the-lamp" }), M({ by: "the-town", slug: "the-bounty-board" })]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.deepEqual(c.hand, [], "a sweep published it; no hand to find");
    assert.deepEqual(c.handAmends, []);

    const claim = c.claims.find((x) => x.slug === "the-town/the-bounty-board");
    assert.equal(claim.status, "pending", "a resident's claim goes on the docket for the clearing job");
    assert.equal(claim.decided_at, null, "and is not decided by anyone yet");
    assert.equal(claim.data?.locked_by, undefined, "and carries no admission");
  } finally { w.cleanup(); }
});

test("DEC-17: the gate NAMES the replay-only `data` keys and still reds on a record the materializer lost", () => {
  // The write path itself — `insertClaims`' locked INSERT, `materializeClaims`
  // in the era transaction, and the un-admit mangle — has no database in this
  // suite (nothing here opens a connection; see the file header), and is proved
  // by `--can-fail-proof` on the box. What IS pure is the decision this ruling
  // forced on the parity side, so it is extracted and asked here.
  const row = (slug, data) => ({ slug, kind: "sited", owner: "wren", household: "gh:1",
    body: "A thing.", geometry: {}, bbox: "((0,0),(2,2))", status: "standing", parent: null, data });
  const register = [row("the-town/the-bounty-board", { date: "2026-07-01", tier: "market" })];

  // GREEN-ish: the admitted row carries two keys 1.0's file cannot have. Named
  // in `replayOnly`, and NOT reported as a record the materializer lost.
  const admitted = [row("the-town/the-bounty-board",
    { date: "2026-07-01", tier: "market", locked_by: "founder", founder_commit: { sha: "243cc57b9" } })];
  const named = dataFindings(admitted, register);
  assert.deepEqual(named.replayOnly, ["the-town/the-bounty-board"]);
  assert.deepEqual(named.otherData, [], "known provenance must not sit in the finding that means a lost record");
  assert.deepEqual(named.staleTier, []);

  // DEC-16's `formerly` is the same class and is named the same way.
  assert.deepEqual(dataFindings([row("the-town/the-bounty-board",
    { date: "2026-07-01", tier: "market", formerly: ["the-town/old"] })], register).replayOnly,
  ["the-town/the-bounty-board"]);

  // CAN-FAIL 1: the exclusion is exactly those keys. Lose `date` as well and the
  // row lands in `otherData`, which is what that line exists to catch.
  assert.deepEqual(dataFindings([row("the-town/the-bounty-board",
    { tier: "market", locked_by: "founder" })], register).otherData, ["the-town/the-bounty-board"]);

  // CAN-FAIL 2: the tier is still GATED on an admitted row. A stale standing is
  // not excused by how the mark arrived.
  const stale = dataFindings([row("the-town/the-bounty-board",
    { date: "2026-07-01", tier: "home", locked_by: "founder" })], register);
  assert.deepEqual(stale.replayOnly, ["the-town/the-bounty-board"]);
  assert.equal(stale.staleTier.length, 1);
  assert.match(stale.staleTier[0], /data\.tier/);
});

// ── the rename half of DEC-16's tell (M-8, ruled 2026-09-04) ─────────────────
//
// DEC-16 asks "is the file still at its OLD PATH under a new id?", which is the
// whole tell for `the-town/the-lit-name` (world `17103dc37`, whose file never
// moved) and not the whole tell for the record. `61c5fdfbc` — "the cake, the
// vault, and the cellar door PASS FROM THE-TOWN TO WRIGHT" — moves each file into
// the new owner's directory and changes its `by:` in one commit, and git calls it
// a rename (R098, R098, R096, R100). Ruled as plumbing under DEC-16: the tell is
// path identity OR a rename with the same leaf.
//
// The body is long on purpose. Git's rename detection is a similarity score, and
// a five-line file whose one changed line is `by:` scores too low to pair.

const LONG = [
  "The cake stands in the cellar, unlit, and the dungeon is built around it.",
  "Whoever holds the wick holds the room; whoever holds the room owes the town a door.",
  "This body is long so that changing one frontmatter line leaves the file mostly itself,",
  "which is what a rename score measures and what a transfer actually is.",
].join("\n");

/**
 * a → (a commit that MOVES the file) → b. `to` is the new owner, `over` any edit.
 *
 * NO `dir` FIELD. The fixture's `dir` is a register-record field and rides into
 * `data`, so setting it on one side only would derive an amend the record does
 * not have. The default filing IS `by/slug`, so changing `by` moves the file on
 * its own — which is exactly what the founder's commit does.
 */
const handedOver = ({ to = "wright", over = {}, child = null, leaf = "the-unlit-cake" } = {}) => {
  const before = [M({ by: "the-town", slug: "the-unlit-cake", body: LONG })];
  const after = [M({ by: to, slug: leaf, body: LONG, ...over })];
  if (child) {
    before.push(M({ by: "the-town", slug: "the-lit-name", kind: "predicated",
      parent: "the-town/the-unlit-cake", body: LONG }));
    after.push(M({ by: "the-town", slug: "the-lit-name", kind: "predicated",
      parent: `${to}/${leaf}`, body: LONG }));
  }
  return world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00", register: before, log: { "7.jsonl": [] } },
    { subject: HAND, at: "2026-08-26T00:30:00+00:00", register: after, log: { "7.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T01:00:00+00:00", register: after, log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
};

test("M-8: a founder commit that MOVES a mark's file to a new owner is a TRANSFER, not a retirement", async () => {
  const w = handedOver();
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 0, "the record never left canon — it walked into another directory");
    assert.equal(c.unruled.length, 0);
    assert.equal(c.transferred.length, 1);

    const t = c.transferred[0];
    assert.equal(t.from_slug, "the-town/the-unlit-cake");
    assert.equal(t.to_slug, "wright/the-unlit-cake");
    assert.equal(t.amended, false, "only the owner moved, so there is nothing to claim");
    assert.ok(t.moved, "a rename-transfer says on its face that the FILE moved");
    assert.equal(t.moved.from, "WORLD/marks/the-town/the-unlit-cake/mark.md");
    assert.equal(t.moved.to, "WORLD/marks/wright/the-unlit-cake/mark.md");
    assert.match(t.moved.score, /^R\d+$/, "git's own similarity index, carried rather than re-derived");
    assert.equal(t.commit.subject, HAND, "the rename map already named the commit; git is not asked twice");

    // The addition half is not a claim, and it is not the founder's hand either —
    // it is spliced out of `added` before DEC-17 ever asks who planted it.
    assert.deepEqual(c.claims.map((x) => x.slug), []);
    assert.deepEqual(c.hand, []);
    assert.equal(t.synthesised.action, "transfer");
    assert.equal(t.synthesised.object, "wright/the-unlit-cake");
  } finally { w.cleanup(); }
});

test("M-8: a move that ALSO edits the record carries one amend claim, under the new slug", async () => {
  const w = handedOver({ over: { body: `${LONG}\nAnd a line the new owner added.` } });
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 1);
    assert.equal(c.transferred[0].amended, true);
    assert.ok(c.transferred[0].moved, "still a rename-transfer, edit and all");

    const claim = c.claims.find((x) => x.slug === "wright/the-unlit-cake");
    assert.equal(c.claims.length, 1, "one claim, not two — the record changed hands and was edited once");
    assert.equal(claim.supersedes, uuid5("the-town/the-unlit-cake"), "supersedes the STANDING mark's locking claim");
    assert.equal(claim.id, amendId("wright/the-unlit-cake", 8));
  } finally { w.cleanup(); }
});

// ── M-10: the edit half of a rename-transfer is ADMITTED (closed 2026-09-05) ─
//
// The founder's hand has three faces and DEC-17 admits all three, but the probe
// that finds the amending face asked `--diff-filter=M` at the mark's CURRENT
// path — and a rename does not register as a modification there. Git files that
// change under R, against a PATH PAIR, and a pathspec naming one side alone has
// nothing to pair with (`renamesBetween` says the same thing about its own
// query, one function up). So on exactly the commits that both MOVED a record
// and EDITED it, the hand was invisible, and the edit half was derived as a
// resident's ordinary amend claim: pending, for the candle to adjudicate.
//
// `wright/the-candle-vault` is the live case, and it reached the right answer —
// the clearing job's step 1 finds a standing mark at the new slug whose id IS
// the claim's `supersedes`, so it locks as an amend rather than refusing as a
// duplicate. THAT IS WHY IT WAS NOT A BLOCKER AND NOT WHY IT WAS SAFE: a claim
// that arrives at the right verdict by way of a judgement is a claim a judgement
// can refuse. DEC-17 exists to take the judgement out of it.
//
// The fixture is `handedOver` with an edit — the same world M-8 already proves
// is a rename-transfer, so this test adds one question to a shape whose other
// answers are already pinned above rather than building a second world to
// believe in.

test("M-10: a rename-transfer that ALSO edits the record admits the edit — a LOCKED supersede naming the rename's own commit", async () => {
  const w = handedOver({ over: { body: `${LONG}\nAnd a line the new owner added.` } });
  try {
    const c = await claimsFor(w, "a", "b");
    const t = c.transferred[0];
    assert.equal(t.amended, true, "the premise: the record was edited as well as moved");
    assert.ok(t.moved, "and the file really moved, or this is not the seam");

    // The hand is FOUND. Before this fix `handAmends` was empty here, and the
    // claim below was an ordinary pending one.
    assert.equal(c.handAmends.length, 1,
      "the founder's hand was invisible on a rename — the edit half of a transfer went to the candle as a resident's claim");
    assert.equal(c.handAmends[0].slug, "wright/the-unlit-cake");
    assert.equal(c.handAmends[0].sha, t.commit.sha,
      "and it is the rename's OWN commit — the same sha the `transfer` act beside it names, read once");
    assert.equal(c.handAmends[0].subject, HAND);

    const claim = c.claims.find((x) => x.slug === "wright/the-unlit-cake");
    assert.equal(claim.status, "locked",
      "an admission is decided; the clearing job never re-judges canon");
    assert.equal(claim.decided_at, t.commit.at,
      "decided when the founder's commit landed, not at replay time");
    assert.equal(claim.data.locked_by, "founder");
    assert.equal(claim.data.founder_commit.sha, t.commit.sha);
    assert.equal(claim.supersedes, uuid5("the-town/the-unlit-cake"),
      "and it still supersedes the STANDING mark's locking claim — the admission changes how it arrived, not what it says");
    assert.equal(claim.id, amendId("wright/the-unlit-cake", 8));
  } finally { w.cleanup(); }
});

test("M-10: a rename-transfer with NO edit admits nothing — the negative control", async () => {
  // Without this, the test above would pass against a pen that locked every
  // transfer. A move that only changes hands has no edit to admit: `amended` is
  // false, the mark never reaches `amendedByHand`, and there is no claim at all.
  const w = handedOver();
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred[0].amended, false, "only the owner moved");
    assert.deepEqual(c.handAmends, [], "nothing was edited, so there is nothing for the hand to have amended");
    assert.deepEqual(c.claims.map((x) => x.slug), [], "and a transfer is not a claim");
  } finally { w.cleanup(); }
});

test("M-10: a SWEEP commit that renames and edits admits nothing — the publish-subject guard still runs", async () => {
  // The commit that carries a rename is now handed straight to the hand probe,
  // so the guard that decides whether a commit IS the founder's hand has to keep
  // running on it. A sweep published the change; no hand to find, and the claim
  // goes on the docket like any resident's.
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "the-town", slug: "the-unlit-cake", body: LONG })], log: { "7.jsonl": [] } },
    { subject: SWEEP(1), at: "2026-08-26T00:30:00+00:00",
      register: [M({ by: "wright", slug: "the-unlit-cake", body: `${LONG}\nAnd an edit.` })], log: { "7.jsonl": [] } },
    { tag: "b", subject: SWEEP(2), at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wright", slug: "the-unlit-cake", body: `${LONG}\nAnd an edit.` })],
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 1, "still a rename-transfer — DEC-16 never asked whose hand it was");
    assert.equal(c.transferred[0].amended, true);
    assert.deepEqual(c.handAmends, [], "a sweep published it; the publish-subject guard refuses the commit");

    const claim = c.claims.find((x) => x.slug === "wright/the-unlit-cake");
    assert.equal(claim.status, "pending", "a resident's claim goes on the docket for the clearing job");
    assert.equal(claim.decided_at, null);
    assert.equal(claim.data?.locked_by, undefined);
  } finally { w.cleanup(); }
});

test("M-8: a move that RENAMES THE LEAF is not a transfer — the pen does not decide that", async () => {
  // A mark's id is `by` + leaf, so a move that keeps the leaf changes only the
  // owner half of the identity, which is what changing hands means. A move that
  // renames the leaf is a different record wearing a moved file, and it falls
  // through to the retirement branch where an unruled shape belongs.
  const w = handedOver({ leaf: "the-relit-cake" });
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 0, "same owner-move, different leaf — not DEC-16's subject");
    assert.equal(c.retired.length, 1);
    assert.equal(c.retired[0].slug, "the-town/the-unlit-cake");
  } finally { w.cleanup(); }
});

test("M-8: a move that does NOT change the owner is no transfer at all — the mark never left", async () => {
  // The live control, and it is on the record: `319aa3c` moves three mark files
  // from `…/the-three-asks/<leaf>/` to `…/the-asks/<leaf>/` with `by: the-town`
  // unchanged on both sides. Same leaf, real rename, and no transfer — because
  // the slug never moved, so nothing was ever removed and the rename map is not
  // consulted. The removal is the gate; the leaf only narrows inside it.
  //
  // (1.0 has never had a SWEEP commit rename a mark file — zero across the whole
  // history — so the publish-commit control the brief asked for cannot be built
  // from the record, and the widened tell does not ask whose hand it was anyway:
  // DEC-16 never has. This is the control that exists.)
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "the-town", slug: "blueprint", dir: "the-three-asks/blueprint", body: LONG })],
      log: { "7.jsonl": [] } },
    { subject: HAND, at: "2026-08-26T00:30:00+00:00",
      register: [M({ by: "the-town", slug: "blueprint", dir: "the-asks/blueprint", body: LONG })],
      log: { "7.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "the-town", slug: "blueprint", dir: "the-asks/blueprint", body: LONG })],
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.deepEqual(c.transferred, [], "a rename is only ever consulted for a slug that LEFT the register");
    assert.deepEqual(c.retired, []);
    // The era does derive one amend here, and it is the FIXTURE's doing rather
    // than the record's: `dir` is a register-record field in this harness and
    // rides into `data`, so moving the file changes the record. On the real
    // record `319aa3c` produced no amend for these three marks (window 159's
    // amend list does not name them). Asserted as the artifact it is rather than
    // asserted around.
    assert.deepEqual(c.claims.map((x) => x.slug), ["the-town/blueprint"]);
  } finally { w.cleanup(); }
});

// ── a reference follows the ROW, not the NAME (ruled 2026-09-04) ─────────────
//
// The test that stood here one lap ago asserted the OPPOSITE — that the child's
// claim carries `uuid5(new slug)`, "a number no row carries". It was right about
// the record and wrong about what should happen. The law moved, so the assertion
// moved with it, and that is said out loud rather than quietly rewritten:
//
//   "a claim's `parent` resolves through the STANDING row for the parent's slug,
//    never through uuid5(name) — the same law DEC-16 already gives `supersedes`."
//
// `deriveSeed` cannot do this and must not: it reads a checkout, it is shared
// with `seed-import.mjs`, and it IS the parity oracle — an oracle that consulted
// the store about this column could never disagree with the store about it.

test("the child of a transferred mark carries the parent's ORIGINAL id, so the foreign key holds", async () => {
  const w = handedOver({ child: true });
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 1);
    assert.deepEqual(c.transferred[0].children, ["the-town/the-lit-name"],
      "the receipt still names which rows the rule moved");

    const child = c.claims.find((x) => x.slug === "the-town/the-lit-name");
    assert.ok(child, "the child is an amend, because its parent moved under it");
    assert.equal(child.parent, uuid5("the-town/the-unlit-cake"),
      "the id the row KEPT — `marks.parent REFERENCES marks(id)` resolves");
    assert.notEqual(child.parent, uuid5("wright/the-unlit-cake"),
      "and NOT the one the checkout derived from the new name");

    assert.deepEqual(c.parentResolved, [{
      slug: "the-town/the-lit-name",
      derived: uuid5("wright/the-unlit-cake"),
      standing: uuid5("the-town/the-unlit-cake"),
    }], "and the run says what it moved, with both numbers");
  } finally { w.cleanup(); }

  // The same transfer WITHOUT a child names none, or `children` is measuring
  // nothing and the assertion above is about a truthy array.
  const alone = handedOver();
  try {
    const c = await claimsFor(alone, "a", "b");
    assert.deepEqual(c.transferred[0].children, []);
    assert.deepEqual(c.parentResolved, []);
  } finally { alone.cleanup(); }
});

test("a child whose parent did NOT move resolves to the same id as before — the negative control", async () => {
  // Same shape, same child, and the parent stays `the-town`. Nothing is
  // re-identified, so nothing is resolved and the claim carries exactly what the
  // checkout derived. Without this the rule could be rewriting every parent it
  // sees and the test above would not notice.
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "the-town", slug: "the-unlit-cake", body: LONG }),
        M({ by: "the-town", slug: "the-lit-name", kind: "predicated", parent: "the-town/the-unlit-cake", body: LONG })],
      log: { "7.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "the-town", slug: "the-unlit-cake", body: LONG }),
        M({ by: "the-town", slug: "the-lit-name", kind: "predicated", parent: "the-town/the-unlit-cake",
          body: LONG + "\nAnd a line the owner added." })],
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.deepEqual(c.transferred, []);
    assert.deepEqual(c.parentResolved, [], "nothing moved, so nothing is resolved");
    const child = c.claims.find((x) => x.slug === "the-town/the-lit-name");
    assert.equal(child.parent, uuid5("the-town/the-unlit-cake"), "byte-identical to what the checkout derived");
  } finally { w.cleanup(); }
});

test("the resolution outlives the era it happened in, and chains across two changes of hands", async () => {
  // A transfer's consequences do not stop at its own era: a child amended three
  // eras later still derives the parent's CURRENT name. The map is the caller's
  // and is threaded, so this asks `eraClaims` the way `main()` asks it.
  const carried = new Map([[uuid5("wright/the-unlit-cake"), uuid5("the-town/the-unlit-cake")]]);
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wright", slug: "the-unlit-cake", body: LONG }),
        M({ by: "the-town", slug: "the-lit-name", kind: "predicated", parent: "wright/the-unlit-cake", body: LONG })],
      log: { "7.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wright", slug: "the-unlit-cake", body: LONG }),
        M({ by: "the-town", slug: "the-lit-name", kind: "predicated", parent: "wright/the-unlit-cake",
          body: LONG + "\nEdited a whole era later." })],
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const a = checkout(w.dir, w.tags.a), b = checkout(w.dir, w.tags.b);
    try {
      const window = eraWindow({ toDir: b.dir, lawSha: w.tags.b, townSha: null });
      const c = await eraClaims({
        fromDir: a.dir, toDir: b.dir, window, acts: eraActs({ fromDir: a.dir, toDir: b.dir }),
        worldRepo: w.dir, fromSha: w.tags.a, toSha: w.tags.b, reidentified: carried,
      });
      assert.deepEqual(c.transferred, [], "this era transfers nothing — the change of hands was earlier");
      const child = c.claims.find((x) => x.slug === "the-town/the-lit-name");
      assert.equal(child.parent, uuid5("the-town/the-unlit-cake"),
        "and the earlier era's re-identification still governs");
    } finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }

  // CHAINED, because a mark may change hands twice: the second entry must point
  // at the ORIGINAL id and not at an intermediate name, which no row carries
  // either. Asked of a real transfer rather than of a hand-built map.
  const twice = handedOver({ child: true });
  try {
    const c = await claimsFor(twice, "a", "b");
    const again = new Map(c.reidentified);
    const standing = (id) => again.get(String(id)) ?? String(id);
    again.set(uuid5("keith/the-unlit-cake"), standing(uuid5("wright/the-unlit-cake")));
    assert.equal(again.get(uuid5("keith/the-unlit-cake")), uuid5("the-town/the-unlit-cake"),
      "two changes of hands, and the row's own id is still what a reference finds");
  } finally { twice.cleanup(); }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function checkout(repo, sha) {
  const dir = mkdtempSync(join(tmpdir(), "w2rt-"));
  rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "--quiet", dir, sha], { encoding: "utf8" });
  return { dir, dispose: () => execFileSync("git", ["-C", repo, "worktree", "remove", "--force", dir]) };
}

/** The same as `claimsFor`, but for an era `erasBetween` already resolved (F-5). */
async function claimsForShas(w, era) {
  const a = checkout(w.dir, era.from.sha), b = checkout(w.dir, era.to.sha);
  try {
    const window = eraWindow({ toDir: b.dir, lawSha: era.to.sha, townSha: null });
    return await eraClaims({
      fromDir: a.dir, toDir: b.dir, window,
      acts: eraActs({ fromDir: a.dir, toDir: b.dir }),
      worldRepo: w.dir, fromSha: era.from.sha, toSha: era.to.sha,
    });
  } finally { b.dispose(); a.dispose(); }
}

async function claimsFor(w, fromTag, toTag) {
  const a = checkout(w.dir, w.tags[fromTag]), b = checkout(w.dir, w.tags[toTag]);
  try {
    const window = eraWindow({ toDir: b.dir, lawSha: w.tags[toTag], townSha: null });
    // The same four things the CLI hands it: the two trees, the era's derived
    // acts (DEC-15 case (a) is decided out of them), and the repo + shas that
    // case (b) attributes a removal to.
    return await eraClaims({
      fromDir: a.dir, toDir: b.dir, window,
      acts: eraActs({ fromDir: a.dir, toDir: b.dir }),
      worldRepo: w.dir, fromSha: w.tags[fromTag], toSha: w.tags[toTag],
    });
  } finally { b.dispose(); a.dispose(); }
}

// ── the door's own witness ───────────────────────────────────────────────────

test("a leave-mark act and the outcome-derived claim set are matched by slug, and drafts are named not counted", () => {
  const acts = { rows: [
    { action: "legacy:leave-mark", actor: "neth", at: "2026-08-27T15:24:32.334Z", payload: { object: "neth/little-free-library" } },
    { action: "legacy:leave-mark", actor: "wren", at: "2026-08-27T16:00:00.000Z", payload: { object: "wren/a-draft-that-never-published" } },
    { action: "legacy:departure", actor: "wren", at: "2026-08-27T16:01:00.000Z", payload: {} },
  ] };
  const w = doorWitness({ acts, claims: [{ slug: "neth/little-free-library" }, { slug: "fabel/garrison-bridge" }] });
  assert.equal(w.total, 2, "only leave-mark acts are the door's witness about a claim");
  assert.deepEqual(w.matched.map((m) => m.slug), ["neth/little-free-library"]);
  assert.deepEqual(w.unmatched.map((m) => m.slug), ["wren/a-draft-that-never-published"]);
});
