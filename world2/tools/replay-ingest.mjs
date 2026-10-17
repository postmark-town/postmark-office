#!/usr/bin/env node
// replay-ingest.mjs — THE REPLAY-PARITY GATE. Phase 5 of the World 2.0 migration.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 4, phase 5), verbatim:
//
//   "Phase 5 — the replay-parity gate (= Keemin's D-amendment, THE cutover gate):
//    World 2.0 must ingest the settlements/events that happened on prod in the
//    meantime and reach the same output state. The ingester is the migration's
//    proof and a harness we want anyway."
//
// ── WHAT "REACH THE SAME OUTPUT STATE" MEANS HERE, AND WHAT IT DOES NOT ──────
//
// This is INGEST-AND-REACH, not re-adjudicate. World 1.0 already ruled every one
// of these settlements; 2.0's job is to be handed the same era and arrive at the
// same register. So for each settlement S(k) the harness does four things:
//
//   (a) ACTS — the era's STATE/log rows become `acts`, by seed-import's own
//       `deriveActs`, MINUS the ones the store already holds. The era is the
//       multiset DIFFERENCE between the two tags, because 1.0 appends to a
//       crossing's log file AFTER the settlement that preceded it (S47→S48 adds
//       34 rows to `150.jsonl`, a file that already existed at S47 — see
//       `eraActs`). Since the first pen flip (stance, 2026-09-02) the log is
//       also a photograph of rows Postgres already wrote, so the derived set and
//       the store OVERLAP; `insertActs` dedupes by (actor, action, written_at)
//       and reports what it skipped. See its own note.
//
// ── AN ERA IS ONE PUBLISH, NOT ONE TAG (F-5, 2026-09-04) ────────────────────
//
// The Worldkeeper mints a `settlement/S<n>` tag when his JUDGMENT lands. The box
// publishes at every crossing and on demand between them, committing a
// `settlement: sweep N published, …` each time with its own six-count. Those were
// the same thing through S50 and have not been since: SEVEN publishes sit between
// the S50 and S51 tags. Pairing tags made one era out of seven, so six sweeps'
// worth of claims were derived against the seventh's receipt and every retirement
// filed at the last window instead of the one it happened at.
//
// So the boundaries are the publish commits; the tags are the RANGE's ends, the
// seed's floor, and the names an era wears when it has one. `erasBetween` walks
// `--first-parent` and takes every commit whose subject is a sweep.
//
// WHAT THIS DID NOT FIX, because the record says otherwise: a publish is not a
// window either. Five sweeps landed inside window 163 on 2026-09-01 (14:07,
// 14:28, 14:38, 14:47, then the 17:45Z crossing), and windows 154, 156–158 and
// 166 closed with no sweep behind them at all. A CROSSING closes a window; a
// sweep publishes into whichever one is open. `windowFindings` names every such
// departure and the run refuses, because the store clears exactly one candle at a
// time. See the report's F-5 section for the three readings and their costs.
//
//   (b) CLAIMS — the era's claim set is derived from the settlement's OWN
//       OUTCOME: the difference between the marks registers at S(k-1) and S(k),
//       read by `deriveSeed` at each tag. A mark that appeared is a claim that
//       was submitted in that window; a mark whose record changed is an amend,
//       carrying `supersedes` to the standing mark it continues. We do not
//       re-derive who MIGHT have claimed what — the settlement's outcome is the
//       record of what was claimed, and it is the only record that survives (the
//       sketchbook branches the claims actually lived on are rebased away, which
//       is gold §1's "rebased → ceases to exist: git mechanics, not a decision").
//       A mark that LEFT the register is a RETIREMENT, not a claim (DEC-15,
//       2026-09-04): `marks.status = 'retired'` at the era's window, with the
//       `withdraw` act either found in the era's log or synthesised by `the-town`
//       from the commit that removed the record. See `eraClaims`. A mark whose
//       FILE stayed while its `by:` changed did not leave at all — it CHANGED
//       HANDS (DEC-16, ruled 2026-09-04): the same row keeps its id, `slug` and
//       `owner` move together, `data.formerly` keeps the old name, one `transfer`
//       act by `the-town` names the commit, and the addition half is NOT a claim.
//       A departure of any OTHER shape still refuses the era, at the write rather
//       than at derivation, so one dry run shows the founder the whole class.
//
//       AND WHERE THE HAND IS THE FOUNDER'S OWN, THE CLAIM IS AN ADMISSION
//       (DEC-17, ruled 2026-09-04). A mark his commit on `main` put into the
//       register — no door, no sweep — is not a resident's claim for the clearing
//       job to adjudicate; it is canon already published, and a job that never
//       saw it must not be allowed to refuse it. So the claim goes in `locked`,
//       decided at the commit's own time, naming the commit in `data`, and the
//       mark materialises in the same transaction through the clearing job's own
//       `materializeClaims`. The same for an amend by that hand, superseding the
//       standing mark. The six-count receipt is UNCHANGED by this: 1.0 never
//       counted hand plantings either, which is why the disagreements it names
//       are the accounting and not a fault.
//
//   (c) LAW + STAMPS at the era's sha, by the ingester's own pen — `law_ingest`
//       against the S(k) checkout, so `law_projection` carries a row set stamped
//       with that settlement's sha and the clearing computes against law as-of
//       that moment (gold §3 rule 2's determinism property).
//
//   (d) THE REAL CLEARING JOB, on that window. Not a re-implementation and not a
//       shortcut: `clearing-job.mjs`, the pen that will run in production, under
//       its own role. That is the entire value of this gate. A parity failure
//       that came from a replay-only code path would prove nothing about the
//       cutover; a REFUSAL from the production pen on canon that 1.0 published is
//       precisely what we are here to find, and it is reported verbatim rather
//       than worked around.
//
// ── THE PARITY CHECK IS THE GATE ────────────────────────────────────────────
//
// After each window clears, 2.0's standing register must say what 1.0's says at
// S(k). The comparator is `seed-import.mjs`'s own `compareMarks` — the same code
// that verifies the seed, so a green replay and a green seed mean the same thing.
// Two scopes, and the split is deliberate rather than convenient:
//
//   SUBSTANCE (the gate) — kind, owner, household, body, geometry, bbox, status.
//     What the world IS. Any divergence here is a failed gate.
//   PROVENANCE (reported, not gated) — `locked_window` differs BY CONSTRUCTION
//     (a replayed mark locks in the window that actually cleared it, which is the
//     point), and any column 2.0's write path leaves NULL is reported as its own
//     named finding with a count, never silently narrowed away. A comparator that
//     quietly skips a column is the thing seed-import's own verifier is against.
//
// Plus ACTS COMPLETENESS per era: crossing by crossing, the checkout's log rows
// against `acts` — ab-compare.mjs's AB-P1 sweep, asked of one era instead of the
// whole history, and bucketed by FLOOR for AB-P1's own reason.
//
// ── THE STATELESS CONTRACT (gold § 2, the git-facing reuse line) ─────────────
//
//   "The two new sync jobs (law_ingester, snapshot_exporter) are built small and
//    STATELESS — GitHub-API commits or fresh shallow clone per run, discarded
//    after; NO long-lived clones on the box, which makes the month's entire
//    clone-pathology class (wedged rebases, ownership poisonings, stash/upstream
//    traps, ff-freezes) unrepresentable."
//
// The replay needs FOUR checkouts of one repo at once, which is the one place
// this contract needs a sentence of its own. The caller supplies a clone; this
// tool NEVER moves it — no checkout, no fetch, no rebase, no clean, and `HEAD`
// is exactly where the caller left it when the run ends. Each era's two trees are
// throwaway `git worktree --detach` checkouts in a temp directory, created from
// the caller's object store and removed on the way out. That is "a fresh checkout
// per run, discarded after", spelled for a tool that reads four shas.
//
// The clone must be FULL HISTORY. `--depth 1` carries one commit and the replay
// reads four; the world-hydrate lane already paid for that lesson.
//
// ── THE PEN: THIS IS A MIGRATION, NOT A RUNTIME PATH ────────────────────────
//
// Same pen and the same justification as `seed-import.mjs` and
// `ledger-backfill.mjs`: this connects as **world2_owner** to insert the era's
// `acts` and its pending `claims`, because those are the seed's own tables and
// this is the seed's own class of operation — a migration, run by hand, not
// reachable from any request path. It holds NO pen over an outcome: the clearing
// runs as `clearing_job` and the law ingest as `law_ingester`, each shelled to
// its own tool with its own credential, exactly as `clearing-job.mjs` shells to
// `stamp-ingest.mjs` rather than borrowing its grants.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   git clone https://github.com/postmark-town/postmark-world.git /tmp/world-full
//
//   export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=…
//   export WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost/world2_dev
//   export WORLD2_INGEST_URL=postgres://law_ingester:…@localhost/world2_dev
//
//   node world2/tools/replay-ingest.mjs \
//     --world-repo /tmp/world-full --from-tag settlement/S47 --to-tag settlement/S50
//
//   --world-repo <clone>     full-history checkout of the world repo (never moved)
//   --from-tag <ref>         the floor already in the store (the seeded settlement)
//   --to-tag <ref>           replay through this settlement, inclusive
//   --town-repo <checkout>   run the stamp ingest as the clearing's first step
//   --town-sha <sha>         the town half of the pin, when a receipt names one
//   --continue               eras already in the store are VERIFIED, then skipped
//   --can-fail-proof         mangle the replayed register inside a ROLLED-BACK
//                            transaction and require the gate to go red for each;
//                            also injects a duplicate act, in the PEN's spelling,
//                            and requires the ingest's dedupe to catch it, and
//                            un-retires a retired mark and requires DEC-15's
//                            standing-only filter to notice it standing again
//   --dry-run                derive and report; open no connection, write nothing.
//                            Exits 1 when an era carries a departure DEC-15 does
//                            not rule on, and names every one of them
//   --json                   machine-readable verdict
//
// Re-running without `--continue` on a store that has moved past the floor is
// REFUSED, in seed-import's idiom and for its reason: a half-replayed world is
// the one outcome with no honest description, and `acts` is append-only for every
// pen, so there is no repair path — only a first run, a verified continuation, or
// a rebuild. `--help` prints how to re-floor.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deriveSeed, deriveActs, genesisWindow, uuid5, compareMarks, canonicalJson, LOG_FILE,
} from "./seed-import.mjs";
// DEC-17's marks are materialised by THE SAME function the clearing job and the
// review lane call, never a third way of turning a claim into a mark. See
// `materialize.mjs`' own header: it was extracted the day a second lawful writer
// of `marks` appeared, precisely so a third would import it instead of copying.
import { materializeClaims } from "./materialize.mjs";
// DEC-18 — the cause of each parity finding. The RULES live there and are pure;
// the git/store lookups are the adapter beneath them. Nothing about "which of
// these findings is the store's fault" is decided in this file.
import { classifyFinding, historyFor, claimsFor, renderCauses, parseFinding } from "./parity-causes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Attach a cause to every substance finding (DEC-18).
 *
 * BEST-EFFORT, AND NEVER A PASS. Building the lookups reads the checkout with the
 * repo's own loader and shells out to git; if any of that fails the run prints the
 * findings exactly as it did before and every one of them still reds. The only
 * thing a classification can do is move a finding to INFO, and only three causes
 * can do that — see `parity-causes.mjs § OUT-OF-SCOPE IS NOT A SYNONYM FOR QUIET`.
 */
export async function classifyParity(findings, { worldRepo, sha, client }) {
  if (!findings.length || !worldRepo || !sha) return null;
  // The records must come from the world AT `sha`, not from whatever the clone's
  // working tree is sitting at — the same binding `planBackfill` was returned for
  // missing. A detached worktree, disposed either way.
  let co = null;
  try {
    co = checkoutAt(worldRepo, sha, "causes");
    const record = await historyFor({ worldRepo, checkoutDir: co.dir, sha });
    const slugs = findings.map((f) => parseFinding(f)?.slug).filter(Boolean);
    const claim = client ? await claimsFor(client, [...new Set(slugs)]) : () => null;
    return findings.map((f) => classifyFinding(f, { record, claim }));
  } catch (err) {
    console.log(`  (causes unavailable: ${String(err.message).split("\n")[0]} — every finding above still reds)`);
    return null;
  } finally {
    co?.dispose();
  }
}

// ── git: reads only, and the caller's checkout is never one of the things moved ─

const git = (repo, ...args) =>
  execFileSync("git", ["-C", resolve(repo), ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

/**
 * Resolve a tag or sha to its commit, refusing rather than guessing.
 *
 * `^{commit}` because the settlement tags are ANNOTATED (`git tag -a`), so a bare
 * `rev-parse settlement/S49` returns the tag OBJECT's sha — a value that is not
 * the commit, would be pinned into `windows.law_sha`, and would make every
 * downstream "reproducible from (claims, law_sha, town_sha)" claim a lie that
 * nothing could detect. seed-import's `assertRef` learned this on `sandbox/seed`.
 */
export function commitOf(repo, ref) {
  try { return git(repo, "rev-parse", `${ref}^{commit}`); }
  catch {
    throw new Error(
      `${ref} does not resolve to a commit in ${resolve(repo)}. ` +
      `A --depth 1 clone carries one commit and this replay reads four: clone with full history.`);
  }
}

/**
 * The settlement tags between two refs, in the order the town made them.
 *
 * Discovered from the repo rather than declared on the command line, because the
 * ERA BOUNDARIES ARE FACTS OF THE RECORD and a hand-typed list is a second copy
 * of them. `--from-tag` names the floor already in the store; every settlement
 * tag whose commit is a descendant of it and an ancestor of `--to-tag` is an era,
 * and they are ordered by commit date, which is when the settlement landed.
 */
export const PUBLISH_SUBJECT = /^settlement: sweep \d+ published, \d+ unpublished/;

export function erasBetween(repo, fromRef, toRef) {
  const from = commitOf(repo, fromRef), to = commitOf(repo, toRef);
  if (from === to) {
    throw new Error(`${fromRef} and ${toRef} are the same commit (${from.slice(0, 8)}) — there is nothing to replay`);
  }

  // Which commits a settlement tag points at, so an era that has a name is called
  // by it. ONE `for-each-ref` rather than a `rev-parse` per tag: `*objectname`
  // is the ANNOTATED tag's dereferenced commit, which is the whole reason
  // `commitOf` exists, and the world carries fifty-odd of these.
  //
  // SPACE-SEPARATED, and not `%x1f`, because `for-each-ref` and `log` do NOT
  // speak the same format dialect: `log --format` expands `%x1f` to the byte,
  // `for-each-ref` emits the four characters verbatim. Caught by a test that
  // expected a tag name and got `publish/3b432768` — a silent miss, since a map
  // keyed on garbage simply never matches and every era looks untagged. A
  // refname carries no whitespace and an objectname is hex, so a space is a
  // sound separator here; `*objectname` is EMPTY for a lightweight tag, which is
  // why the refname goes FIRST and the optional field last.
  //
  // EVERY tag, not just `settlement/*`, and that widening is safe BECAUSE the
  // tags no longer decide anything. Under the tag model this scan chose the era
  // boundaries and had to be exact; now the boundaries are the publish subjects
  // and this map only supplies a NAME, so a commit carrying any tag is better
  // reported by it than by `publish/<sha8>`. A `settlement/` tag still wins when
  // two point at one commit — that is the name the town uses.
  const tagOf = new Map();
  for (const line of git(repo, "for-each-ref", "--format=%(refname:short) %(objectname) %(*objectname)",
    "refs/tags/**").split("\n").filter(Boolean)) {
    const [name, obj, deref] = line.trim().split(/\s+/);
    const sha = deref || obj;
    const had = tagOf.get(sha);
    if (!had || (!had.startsWith("settlement/") && name.startsWith("settlement/"))) tagOf.set(sha, name);
  }

  // FIRST-PARENT, and in the order the town made them. `--first-parent` walks the
  // mainline the sweep commits onto; date order was right while every boundary
  // was a hand-made tag and is not a property of history — a merge can carry a
  // commit whose date precedes the one before it, and an era pair in the wrong
  // order compares a register against the wrong tag.
  const walk = git(repo, "log", "--first-parent", "--reverse",
    `--format=%H${UNIT_SEP}%cI${UNIT_SEP}%s`, `${from}..${to}`)
    .split("\n").filter(Boolean)
    .map((l) => { const [sha, at, subject] = l.split(UNIT_SEP); return { sha, at: new Date(at).toISOString(), subject }; });

  if (!walk.length) {
    throw new Error(
      `${toRef} (${to.slice(0, 8)}) is not ahead of ${fromRef} (${from.slice(0, 8)}) on the first-parent line — ` +
      `there is nothing to replay between them.`);
  }

  // ── SEGMENT BY THE TOWN'S OWN CLOCK ──────────────────────────────────────
  //
  // The town commits `crossing-save <N>` at every crossing and NAMES the window
  // in the subject, so the partition is read rather than inferred: everything
  // after `crossing-save N` and before `crossing-save N+1` happened in window N.
  // Verified against the record — `crossing-save 163` lands 12:03Z on 09-01 and
  // the five sweeps that follow it (14:07, 14:28, 14:38, 14:47, 17:45) all
  // resolve to 163 by the log rule, while `settlement: sweep 9 …` at 06:11Z,
  // before it, resolves to 162.
  //
  // The era's `to` is the LAST COMMIT of the segment, whatever kind it is. Not
  // the last publish: a `drain:` commit after it photographs more log rows into
  // the same window, and stopping at the publish would push those acts into the
  // NEXT era — filing them at a crossing they did not happen in, which is the
  // exact defect this lane exists to remove. The register is unchanged by a
  // drain, so the parity oracle reads the same world either way.
  // ── A WINDOW BEGINS WHERE ITS LOG FILE DOES (ruled 2026-09-04, § 9) ────────
  //
  // The first cut of this read the HIGHEST INTEGER `<n>.jsonl` at each boundary
  // commit. That is what `genesisWindow` does, and it is right whenever the town
  // saves on time — but it LAGS a missed save, and this range carries one. There
  // is no `crossing-save 154` anywhere in the repository: `154.jsonl` was not
  // written until `c701988f9` (crossing-save 155) at 13:27Z on 08-28, hours after
  // window 154 had come and gone. So the integer scan saw the clock go 153 → 155,
  // reported a hole, and filed two sweeps that published INSIDE 154 under 153.
  //
  // The `.journal` form does not lag. A drain, `a31796fac` at 06:05Z that
  // morning, wrote `154.journal.jsonl` while the integer log still said 153 — and
  // 06:05Z is inside window 154's own declared span (`154.meta.json`: covers_from
  // 08-28T00:00, covers_to 08-28T12:00, complete). The journal tracks the real
  // clock; the integer file is a save's record of it, and a save can be missed.
  //
  // So a window's boundary is the FIRST commit naming either form of its log,
  // whatever that commit's subject says. `crossing-save N` is the common case, a
  // drain the honest exception, and the exception is reported by name rather than
  // smoothed. One `git log` answers it for every window at once — cheaper than
  // the per-commit `ls-tree` it replaces, and it sees a window the tree cannot.
  const opensAt = new Map();                       // window → the sha that first names it
  {
    const MARK = String.fromCharCode(0x01);        // no path or sha begins with it
    const out = git(repo, "log", "--first-parent", "--reverse", "--diff-filter=A",
      `--format=${MARK}%H`, "--name-only", `${from}..${to}`, "--", "STATE/log/");
    let sha = null;
    for (const line of out.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith(MARK)) { sha = l.slice(1); continue; }
      const m = /^STATE\/log\/(\d+)(?:\.journal)?\.jsonl$/.exec(l);
      if (m && sha && !opensAt.has(Number(m[1]))) opensAt.set(Number(m[1]), sha);
    }
  }
  const opensHere = new Map();                     // sha → the window(s) it first names
  for (const [w, sha] of opensAt) {
    if (!opensHere.has(sha)) opensHere.set(sha, []);
    opensHere.get(sha).push(w);
  }
  for (const list of opensHere.values()) list.sort((a, b) => a - b);

  const segments = [];
  let cur = null;
  for (const c of walk) {
    const opened = opensHere.get(c.sha);
    if (opened) {
      // One commit may name several windows at once — the save that finally wrote
      // a completed window's log also wrote its successor's. Each still gets its
      // own era, in order, because the store clears one candle at a time; every
      // window but the last closes WHERE IT OPENS, which is what a folded save
      // means. That era is real and empty, and empty is the only honest shape:
      // no tree ever stood between them, so there is no world to put in it.
      for (const w of opened) {
        cur = { window: w, statedWindow: null, opensAt: c.sha,
          foldedWith: opened.length > 1 ? opened : null, commits: [], publishes: [] };
        segments.push(cur);
        if (w !== opened[opened.length - 1]) cur.commits.push(c);
      }
    }
    if (!cur) {                                   // before the range's first boundary
      cur = { window: null, statedWindow: null, opensAt: null, foldedWith: null, commits: [], publishes: [] };
      segments.push(cur);
    }
    const save = CROSSING_SAVE.exec(c.subject);
    if (save && cur.statedWindow == null) cur.statedWindow = Number(save[1]);
    cur.commits.push(c);
    if (PUBLISH_SUBJECT.test(c.subject)) cur.publishes.push(c);
  }

  const eras = [];
  let prev = { tag: fromRef, sha: from };
  for (const seg of segments) {
    // A segment with no commits at all cannot be an era; a LEADING segment with
    // no publish is the tail of a window the floor already holds, and skipping it
    // is not a loss — its `to` would be the same tree as `from`.
    if (!seg.commits.length) continue;
    if (seg.window == null && !seg.publishes.length) continue;
    const c = seg.commits[seg.commits.length - 1];
    const t = { tag: tagOf.get(c.sha) ?? `window/${seg.window ?? c.sha.slice(0, 8)}`,
      sha: c.sha, at: c.at, subject: c.subject };
    eras.push({ from: prev, to: t, publishes: seg.publishes, statedWindow: seg.statedWindow,
      window: seg.window, opensAt: seg.opensAt, foldedWith: seg.foldedWith });
    prev = t;
  }

  // The range's end must be an era boundary even if the town's last crossing-save
  // is behind it — `--to-tag` is where the caller said to stop.
  const last = eras[eras.length - 1];
  if (!last || last.to.sha !== to) {
    const c = walk[walk.length - 1];
    eras.push({
      from: prev,
      to: { tag: tagOf.get(to) ?? toRef, sha: to, at: c.at, subject: c.subject },
      publishes: [], statedWindow: null,
    });
  }
  return eras;
}

/** The town's own statement that its clock advanced, and to what. */
export const CROSSING_SAVE = /^crossing-save (\d+)\b/;

/**
 * THE ERA'S RECEIPT WHEN A WINDOW HELD SEVERAL SWEEPS (F-5 reading 3).
 *
 * A window is the store's unit and a six-count belongs to a SWEEP, so an era that
 * holds five sweeps is held to the SUM of their counts. The sum alone would be a
 * weaker check than the one it replaces, though — five sweeps publishing 5, 1, 1,
 * 1, 1 and one publishing 9 both total nine, and the le-petit-berthillon miscount
 * was caught by exactly the precision the sum throws away. So each sweep is ALSO
 * held to its own count, as an inner probe over the same interval it published
 * in, and the era reports both.
 *
 * `sum` is what the era is judged on; `probes` is where a disagreement is located.
 * A window with no sweep at all gets neither: its receipt is "no sweep", which is
 * not the same statement as "published 0" and must not be printed as one.
 */
export function eraReceipt({ publishes, derived }) {
  if (!publishes.length) return { checked: false, noSweep: true, why: "no sweep ran in this window — the crossing closed with the register unchanged" };
  const six = publishes.map((p) => sixCountOf(p.subject)).filter(Boolean);
  if (six.length !== publishes.length) {
    return { checked: false, why: `${publishes.length - six.length} of this window's sweep commits carry no readable six-count` };
  }
  const sum = six.reduce((n, s) => n + s.published, 0);
  return {
    checked: true, ok: sum === derived, six: { published: sum }, sweeps: publishes.length,
    why: sum === derived ? null
      : `this window's ${publishes.length} sweep(s) published ${sum} between them by their own receipts; this replay derives ${derived} claim(s)`,
  };
}

/**
 * THE WINDOWS AN ERA SEQUENCE WALKS, AND THE TWO SHAPES THIS LANE HAS NOT SEEN.
 *
 * Under the publish model the windows should count: 153, 154, … 160, one per
 * sweep, because a sweep is what closes a window. Two departures from that are
 * possible and neither is a thing to guess at:
 *
 *   SAME     two consecutive publishes resolving to one window — a sweep that
 *            closed no window. The store cannot hold it either: the era write
 *            demands the store's open window BE the era's, so the second one
 *            would clear a candle already cleared.
 *   SKIPPED  a window with no publish behind it. It may be a run that refused,
 *            in which case that window's acts belong to the NEXT era and the
 *            receipt for that era is counting a sweep it did not derive. It may
 *            also be a window the checkout's log has simply pruned.
 *
 * Reported here, refused at the write — the same shape as the unruled
 * departures, and for the same reason: one dry run should show the founder the
 * whole class rather than stopping at its first member. The store's own guard
 * ("the store has N open window(s)" / "is window X and the store's open window
 * is Y") would catch both anyway; this names them before a connection is opened.
 */
export function windowFindings(eras) {
  const out = [];
  for (let i = 1; i < eras.length; i++) {
    const prev = eras[i - 1], cur = eras[i];
    const a = prev.window.id, b = cur.window.id;
    if (b === a) {
      out.push({ era: cur, kind: "same", text:
        `${cur.to.tag} resolves to window ${b}, the same window as ${prev.to.tag} — a publish that closed no window` });
    } else if (b < a) {
      out.push({ era: cur, kind: "backwards", text:
        `${cur.to.tag} resolves to window ${b}, BEHIND ${prev.to.tag}'s ${a} — the town's clock does not run backwards` });
    } else if (b > a + 1) {
      const missing = [];
      for (let n = a + 1; n < b; n++) missing.push(n);
      out.push({ era: cur, kind: "skipped", missing, text:
        `${cur.to.tag} resolves to window ${b} and ${prev.to.tag} to ${a} — window(s) ${missing.join(", ")} closed with ` +
        `no publish behind them. If a run refused there, those acts belong to THIS era and its six-count is counting a ` +
        `sweep this era did not derive` });
    }
  }
  return out;
}

// `commitDate` in seed-import reads the checkout's HEAD; here we ask about a sha
// in a repo whose HEAD is the caller's and stays that way.
const commitDate2 = (repo, sha) => new Date(git(repo, "log", "-1", "--format=%cI", sha)).toISOString();

/**
 * A throwaway detached worktree at one sha, and its removal.
 *
 * `git worktree remove` follows into the directory the way `rm -rf` does, so the
 * only thing it is ever pointed at here is a temp directory this function made
 * (the shared-node_modules lesson: a `worktree remove` over a junction empties
 * the junction's target). Nothing is ever linked into these trees.
 */
export function checkoutAt(repo, sha, label) {
  const dir = mkdtempSync(join(tmpdir(), `w2replay-${label}-`));
  // mkdtemp made the directory; `worktree add` wants to make it itself.
  rmSync(dir, { recursive: true, force: true });
  git(repo, "worktree", "add", "--detach", "--quiet", dir, sha);
  return {
    dir,
    dispose: () => {
      try { git(repo, "worktree", "remove", "--force", dir); return; }
      catch { /* fall through to the hand removal + the deregistration it needs */ }
      rmSync(dir, { recursive: true, force: true });
      // Only on the failure path. `prune` is repo-global, and the world clone is
      // shared with a dozen other lanes' worktrees; it is harmless (it drops
      // entries whose directory is already gone) but it is not ours to run for
      // fun.
      try { git(repo, "worktree", "prune"); } catch { /* nothing to prune */ }
    },
  };
}

// ── (a) the era's acts ───────────────────────────────────────────────────────

/**
 * A stable key for one log row, for the multiset difference below.
 *
 * The whole original event, canonically. `deriveActs` carries it verbatim in
 * `payload` (that is its documented shallowness), so this compares the record
 * rather than our translation of it, and `canonicalJson` sorts keys so two
 * readings of the same line cannot differ on spelling.
 */
const actKey = (row) => canonicalJson(row.payload);

/**
 * The acts an era added, as the MULTISET DIFFERENCE of the two checkouts' logs.
 *
 * A set difference would be wrong and quietly so. 1.0's log is append-only per
 * file but the FILES ARE NOT CLOSED at the settlement that names them: the tag
 * S48 sits on `crossing-save 151`, whose commit appends 34 rows to `150.jsonl` —
 * a file that already existed, non-empty, at S47. So "the era's acts" is not
 * "the files that are new"; it is every row present at S(k) beyond what was
 * present at S(k-1).
 *
 * MULTISET, not set, for ab-compare AB-P3's reason: the town's record genuinely
 * repeats a row (the frozen walk ledger carries one departure twice, byte for
 * byte, an append that ran twice), and a Set would let a real duplicate hide.
 */
export function eraActs({ fromDir, toDir }) {
  const before = deriveActs({ worldRepo: fromDir });
  const after = deriveActs({ worldRepo: toDir });

  const have = new Map();
  for (const r of before.rows) { const k = actKey(r); have.set(k, (have.get(k) ?? 0) + 1); }

  const rows = [];
  const vanished = [];
  for (const r of after.rows) {
    const k = actKey(r);
    const left = have.get(k) ?? 0;
    if (left > 0) { have.set(k, left - 1); continue; }
    rows.push(r);
  }
  // A row that was in the earlier checkout and is not in the later one. The log is
  // append-only by law, so this is not a normal outcome and it is not swallowed:
  // it means either a rewrite of history or a pruned window, and either one makes
  // "the same output state" a claim we cannot support for this era.
  for (const [k, n] of have) if (n > 0) vanished.push({ key: k, n });

  const byType = {};
  for (const r of rows) byType[r.action] = (byType[r.action] ?? 0) + 1;
  const crossings = [...new Set(rows.map((r) => Math.floor(r.crossing)))].sort((a, b) => a - b);
  return { rows, byType, crossings, vanished, before: before.rows.length, after: after.rows.length };
}

/** The checkout's own per-crossing row counts, for the completeness check. */
export function logCensus(worldRepo) {
  const dir = join(resolve(worldRepo), "STATE", "log");
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const n = Number(LOG_FILE.exec(f)?.[1]);
    if (!Number.isFinite(n)) continue;
    const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).length;
    const bucket = Math.floor(n);
    out.set(bucket, (out.get(bucket) ?? 0) + lines);
  }
  return out;
}

// ── (b) the era's claims, from the settlement's own outcome ──────────────────

/**
 * The identity of an amend claim.
 *
 * The claim that FIRST locked a slug has id `uuid5(slug)` — seed-import's
 * namespace, so a replayed world and a seeded world number the same mark the same
 * way and a snapshot diff can compare row for row. An amend cannot reuse it (the
 * id is the primary key of the claim that already locked), so it is derived from
 * the same two facts that make it unique: the slug and the window it was
 * submitted in. Deterministic, stable across reruns, and distinct from the
 * original by construction.
 */
export const amendId = (slug, windowId) => uuid5(`amend:${windowId}:${slug}`);

/**
 * THE FIELDS AN AUTHOR CAN CHANGE — which is not the same set as the fields that
 * can DIFFER between two settlements, and the difference is a real finding.
 *
 * A claim is something a resident submitted. So "this record changed, therefore
 * someone claimed" is only sound over the AUTHORED record. Two fields on a seed
 * row are not authored at all: the seed asks the FOLD for them (seed-import §
 * foldOracle), and the fold answers about a record only after it has resolved the
 * WHOLE WORLD —
 *
 *   `household`   the fold's `declared_household` (`households[handle] ?? solo:…`)
 *   `data.tier`   the fold's `markStanding` walk, which reads `_sovereign`,
 *                 `_cred` and `_containedBy`
 *
 * — so either can move because somebody ELSE's mark landed. That is not a
 * hypothetical: between S48 and S49, `berthillon/le-petit-berthillon` goes
 * `tier: market → home` with every authored byte identical, because
 * `berthillon/chez-antoine` (a new PARCEL, someone else's claim in the same
 * window) gives the standing walk sovereign ground to stop at. Counting it as an
 * amend would have submitted a claim on that resident's behalf that they never
 * made, and it would have put the era's claim count at 15 against the
 * settlement's own receipt of 14 published — which is how it was caught.
 *
 * The parity check still compares both fields, and must: the STANDING STATE has
 * to agree with 1.0's whatever caused it to move. That split is what turned the
 * le-petit-berthillon case from a miscount into finding 4 — and finding 4 is now
 * closed at the other end: `clearing-job.mjs` step 7 recomputes standing for
 * every mark inside the window transaction, which is 1.0's own cadence
 * ("derived weight moves at the next Settlement"). So `data.tier` still may not
 * make a claim, and it must now MATCH, and this file asserts both.
 */
export function authoredSubstance(m) {
  const { tier, ...authoredData } = m.data ?? {};   // eslint-disable-line no-unused-vars
  return canonicalJson({
    kind: m.kind, owner: m.owner, body: m.body, geometry: m.geometry,
    bbox: m.bbox ?? null, parent: m.parent ?? null, data: authoredData,
  });
}

/**
 * The settlement's OWN six-count, off the commit it tagged.
 *
 * Every 1.0 settlement receipt carries it (gold §1: "grounded, not imagined —
 * every 1.0 settlement receipt carries the six-count"), and `published` is the
 * number of claims that window locked. So it is a receipt the derived claim set
 * can be held against — a probe that can fail, and did: it is what named the
 * le-petit-berthillon miscount rather than letting a phantom claim through.
 *
 * `null` when the tag does not sit on a settlement commit at all, which is itself
 * worth saying out loud: `settlement/S48` is on `crossing-save 151`. The sweep
 * that closed that window published nothing and therefore committed nothing, so
 * the ceremony tagged whatever HEAD was. A replay of that era has no six-count to
 * check itself against, and the report says so rather than reporting a pass.
 */
export function sixCountOf(subject) {
  const m = /sweep (\d+) published, (\d+) unpublished/.exec(subject ?? "");
  if (!m) return null;
  const rest = /(\d+) left drafted, (\d+) withdrawn, (\d+) quarantined, (\d+) dropped/.exec(subject);
  return {
    published: Number(m[1]), unpublished: Number(m[2]),
    left_drafted: rest ? Number(rest[1]) : null, withdrawn: rest ? Number(rest[2]) : null,
    quarantined: rest ? Number(rest[3]) : null, dropped: rest ? Number(rest[4]) : null,
  };
}

/**
 * What changed in the register between two settlements, as a claim set.
 *
 * The comparison is over `deriveSeed`'s OWN rows at each tag — the seed's row
 * shape, its fold oracle, its geometry, its `data` remainder — because the claim
 * a window received and the mark it materializes are the same record wearing two
 * table names (001: `marks.id` = "the locking claim's id"). Deriving the claim
 * any other way would put a second reading of a mark record into the system, and
 * the parity check would then be comparing two of our own readings rather than
 * the world to the world.
 *
 * Three transitions, and only three are representable:
 *   ADDED     a slug the previous settlement did not carry → a claim, pending.
 *   AMENDED   a slug both carry, whose record differs → a claim that supersedes
 *             the standing mark (its locking claim's id).
 *   RETIRED   a slug the previous settlement carried and this one does not.
 *
 * REMOVED USED TO STOP THE REPLAY, and the refusal was right until it fired:
 * "the refusal exists so that the first one is seen." It was seen on 2026-09-04,
 * on the first full-range dry run (S47 → S55): `the-town/pledges`, removed by the
 * founder's own commit 6b235216d, the three-asks ruling of 2026-08-30. DEC-15
 * (runbook § 9) is the ruling that answers it, and this is that ruling:
 *
 *   A standing mark that leaves the register between settlements is a
 *   RETIREMENT — the revision family's TERMINAL SUPERSESSION, founder-ruled
 *   2026-08-19: "the record leaves canon, its whole life stays in the log."
 *   It is not an invention: the store already spells it (001_tables:
 *   `marks.status IN ('standing','retired')`) and the door already performs it
 *   (`withdrawMarkViaOffice` — "the node leaves your sketchbook now and canon at
 *   the next crossing"). What was missing was the replay's reading of it.
 *
 * A retirement is NOT A CLAIM and does not enter the docket. A claim is something
 * a resident submitted into a window for the clearing to rule on; a retirement is
 * the register having already lost the row by the time the settlement landed. So
 * it rides beside `claims` rather than inside it, and the six-count receipt is
 * untouched — 1.0 never counted founder removals in `published`.
 *
 * TWO CASES, AND THE REPLAY MUST SAY WHICH:
 *   (a) WITHDRAWN IN THE LOG — the era's acts carry a `withdraw` naming the slug.
 *       That act IS the retirement; it is already replayed by `eraActs` and this
 *       synthesises nothing. A resident's own hand, and the log already has it.
 *
 *       AND 1.0 ALREADY COUNTED IT. The refusal this replaces said "1.0's
 *       six-count has no transition that describes a STANDING mark leaving" —
 *       that sentence was wrong, and `sixCountOf` three functions up has always
 *       parsed the counter that proves it: `(\d+) withdrawn`. S55's own receipt
 *       reads "sweep 7 published, 1 unpublished, 45 left drafted, 1 WITHDRAWN",
 *       and that one is `vermillion/the-track-garage`, whose `withdraw` act sits
 *       in the era's log at 2026-09-02T17:32:06.898Z. So case (a) is not a rule
 *       DEC-15 adds to 1.0; it is a transition 1.0 has been counting all along
 *       and 2.0 had no reading for. Only case (b) — the founder's hand on `main`,
 *       which passes no door and enters no sweep — is genuinely uncounted, and
 *       that is why the six-count check stays exactly as it was.
 *   (b) THE FOUNDER'S HAND — no act exists, because the removal was a commit on
 *       world `main` and never passed a door. The log would then be missing the
 *       one event that explains the register, which is exactly what 08-19 forbids
 *       ("its whole life stays in the log"), so the replay SYNTHESISES a
 *       `withdraw` by `the-town` carrying the removing commit's sha and subject.
 *
 * Case (b) needs the removing commit, which needs the mark's FILE, which is a
 * fact of the checkout and not of the register — hence `worldRepo`/`fromSha`/
 * `toSha`. A removal this pen cannot attribute to a commit is still a refusal: a
 * retirement with no hand behind it is the invention DEC-15 was careful not to be.
 *
 * ── AND A DEPARTURE MAY NOT BE A DEPARTURE AT ALL (DEC-16, RULED 2026-09-04) ──
 *
 * The first full-range dry run turned up a third shape wearing the same
 * description, and it is not a retirement: `the-town/the-lit-name`, whose FILE
 * stayed exactly where it was while its `by:` changed (world 17103dc37 — "the Lit
 * Name passes to wright … refolds the id"). A mark's id is `by` + leaf, so the
 * slug moved with the owner and the register read one removal plus one addition
 * for one record changing hands.
 *
 * DEC-16 rules that a TRANSFER IS A RE-IDENTIFICATION: the same row keeps its
 * `id`, `slug` and `owner` move together, `data.formerly` keeps the old slug, and
 * one `transfer` act by `the-town` names the commit. The alternative — retire the
 * old and claim a new one — was rejected for what it costs: the mark's escrow and
 * its whole history hang off the old identity, and a new row inherits none of it.
 *
 * The tell is the FILING, which is why this pen reads it: same path at both tags,
 * a different id standing there. Removal alone cannot distinguish the two, and
 * the register alone cannot either — only the file can say the record survived.
 */
export async function eraClaims({
  fromDir, toDir, window, acts = null, worldRepo = null, fromSha = null, toSha = null,
  reidentified = new Map(),
}) {
  const before = await deriveSeed({ worldRepo: fromDir, lawSha: window.law_sha, townSha: window.town_sha });
  const after = await deriveSeed({ worldRepo: toDir, lawSha: window.law_sha, townSha: window.town_sha });

  const b = new Map(before.marks.map((m) => [m.slug, m]));
  const a = new Map(after.marks.map((m) => [m.slug, m]));

  const added = [], amended = [], removed = [];
  for (const [slug, m] of a) {
    const was = b.get(slug);
    if (!was) { added.push(m); continue; }
    if (authoredSubstance(was) !== authoredSubstance(m)) amended.push({ mark: m, was });
  }
  for (const slug of b.keys()) if (!a.has(slug)) removed.push(slug);

  const retired = [], transferred = [];
  if (removed.length) {
    // The filing is only read when something actually left; a checkout's loader
    // is not cheap and every green era would otherwise pay for the rare one.
    const wasFiled = await markFilingAt(fromDir);
    const nowFiles = await filingOwners(toDir);
    // The era's renames, asked once (M-8). Same guard as the filing reads above:
    // nothing left the register, nothing to ask about.
    const renamed = (worldRepo && fromSha && toSha) ? renamesBetween(worldRepo, { fromSha, toSha }) : new Map();
    for (const slug of removed) {
      const was = b.get(slug);
      const path = wasFiled.get(slug) ?? null;

      const act = (acts?.rows ?? []).find((r) => isWithdrawAct(r) && actObject(r) === slug) ?? null;
      if (act) {
        retired.push({ slug, was, path, case: "a", why: "withdrawn in the log", act, commit: null, synthesised: null });
        continue;
      }

      // THE FILE IS STILL THERE, UNDER A NEW NAME — a RE-IDENTIFICATION (DEC-16).
      // Not a retirement, and this pen does not call it one.
      //
      // "STILL THERE" IS TWO THINGS SINCE M-8: at the same path, or at the path
      // the era MOVED it to. The second is the founder handing a record to its
      // builder — the file walks into the new owner's directory and its `by:`
      // changes in the same commit — and it is DEC-16's subject in the founder's
      // own words ("pass from the-town to wright"), not a retirement.
      //
      // THE LEAF MUST MATCH. A mark's id is `by` + leaf (`marks-fold` § walkMarks),
      // so a move that keeps the leaf changes only the owner half of the identity,
      // which is exactly what changing hands means. A move that also renamed the
      // leaf would be a different record wearing a moved file, and this pen does
      // not get to decide that: it falls through to the retirement branch, which
      // is where an unruled shape belongs.
      let renameOf = null;
      let nowStands = path ? nowFiles.get(path) ?? null : null;
      if (!nowStands && path) {
        const r = renamed.get(path);
        if (r && leafOf(r.to) === leafOf(path)) {
          const movedTo = nowFiles.get(r.to) ?? null;
          if (movedTo && movedTo !== slug) { nowStands = movedTo; renameOf = r; }
        }
      }
      if (nowStands && nowStands !== slug) {
        // The register must actually CARRY the new name. If it does not, the file
        // says one thing and the settlement's outcome says another, and this pen
        // has no business choosing between them.
        if (!a.has(nowStands)) {
          retired.push({
            slug, was, path, case: "unruled", why: "the id refolded, but the register does not carry the new name",
            act: null, commit: null, synthesised: null, becomes: nowStands,
            detail: `the record at ${path} stands as ${nowStands}, which this era's register does not carry either — ` +
              `the file and the settlement's outcome disagree`,
          });
          continue;
        }
        if (!worldRepo || !fromSha || !toSha) {
          throw new Error(
            `${slug} changed hands to ${nowStands} between the two settlements, and DEC-16 names the commit that ` +
            `did it — but this call passed no worldRepo/fromSha/toSha to look it up in.`);
        }
        // A rename ALREADY NAMED ITS COMMIT — the rename map carries the sha, the
        // date and the subject of the very commit that moved the file, so asking
        // git a second time would be a second reading of one fact, and the two
        // could differ. A same-path refold still has to be looked up.
        const commit = renameOf
          ? { sha: renameOf.sha, at: renameOf.at, subject: renameOf.subject }
          : commitTouching(worldRepo, { fromSha, toSha, path, filter: "M" });
        if (!commit) {
          retired.push({
            slug, was, path, case: "unruled", why: "the id refolded with no commit this pen can name",
            act: null, commit: null, synthesised: null, becomes: nowStands,
            detail: `no commit in ${fromSha.slice(0, 8)}..${toSha.slice(0, 8)} modifies ${path}, so DEC-16 has no ` +
              `hand to name in the \`transfer\` act`,
          });
          continue;
        }
        transferred.push({
          from_slug: slug, to_slug: nowStands, was, now: a.get(nowStands), path, commit,
          moved: renameOf ? { from: path, to: renameOf.to, score: renameOf.score } : null,
        });
        continue;
      }

      if (!worldRepo || !fromSha || !toSha) {
        throw new Error(
          `${slug} left the register between the two settlements with no \`withdraw\` act in the era, so ` +
          `DEC-15 case (b) applies and the retirement must name the commit that removed it — but this call ` +
          `passed no worldRepo/fromSha/toSha to look it up in. Pass them, or hand the era its acts.`);
      }
      const commit = path ? removingCommit(worldRepo, { fromSha, toSha, path }) : null;
      if (!commit) {
        retired.push({
          slug, was, path, case: "unruled", why: "no hand this pen can name", act: null, commit: null,
          synthesised: null, becomes: null,
          detail: path
            ? `no commit in ${fromSha.slice(0, 8)}..${toSha.slice(0, 8)} deletes ${path}, and no file at that path ` +
              `stands under another id`
            : `the checkout's own loader files no directory for it, so there is no path to ask git about`,
        });
        continue;
      }
      retired.push({
        slug, was, path, case: "b", why: "the founder's hand", act: null, commit,
        synthesised: synthesisedWithdraw({ slug, window, commit }),
      });
    }
  }

  // ── DEC-16: THE ADDITION HALF OF A TRANSFER IS NOT A CLAIM ─────────────────
  //
  // A transfer reads as one removal AND one addition, and the addition is the
  // sharp end of the ruling. Left in `added` it would derive a claim whose id is
  // the mark's own — `uuid5(new slug)` — and the clearing job would materialize a
  // SECOND marks row under a slug the transferred row is about to take, colliding
  // on `UNIQUE(slug)`. Worse if it did not collide: two rows for one record, the
  // old one orphaned with every by-id reference still pointing at it. Nobody
  // claimed this mark; it changed hands.
  //
  // WHAT SURVIVES AS A CLAIM is anything the author ALSO did in the same era. The
  // comparison is `was` wearing the new owner against `now`: if they agree, the
  // only thing that moved is the identity and there is nothing to claim; if they
  // differ, someone edited the record as well, and that edit is an amend like any
  // other — under the NEW slug, superseding the standing mark's locking claim.
  for (const t of transferred) {
    const i = added.findIndex((m) => m.slug === t.to_slug);
    if (i !== -1) added.splice(i, 1);
    t.amended = authoredSubstance({ ...t.was, owner: t.now.owner }) !== authoredSubstance(t.now);
    if (t.amended) amended.push({ mark: t.now, was: t.was, transfer: t });

    // A RENAME-TRANSFER'S EDIT HALF IS ADMITTED (M-10, closed 2026-09-05).
    // It was not, and this comment used to say it did not need to be:
    // `amendedByHand` asks `--diff-filter=M` at the mark's CURRENT path, a rename
    // does not register as a modification there, and so the founder's hand was
    // invisible on the one commit that both moved the record and edited it —
    // `wright/the-candle-vault`, one amend claim, pending. It reached the right
    // answer anyway, because the clearing job's step 1 finds a standing mark at
    // the new slug whose id IS the claim's `supersedes`. That was the argument
    // for leaving it, and it was the wrong argument: a claim that arrives at the
    // right verdict BY WAY OF A JUDGEMENT is a claim a judgement can refuse, which
    // is the residual exposure DEC-17 exists to remove.
    //
    // `t.commit` is handed to `amendedByHand` now (see its `known` map), so the
    // edit half locks as a founder's admission naming the rename's own commit —
    // the same sha the `transfer` act beside it already names.

    // ── WHAT A TRANSFER'S PREDICATED CHILDREN NEED, WHICH DEC-16 DOES NOT CARRY
    //
    // DEC-16's seam table says `marks.parent` "names a mark by id … follows for
    // free. This is what the fixed id buys." That sentence is true of the STORE
    // and false of the ORACLE, and M-8 is the first era where the difference is
    // reachable, because it is the first transfer with a child.
    //
    // The store's child row points at the parent's kept id and stays right. But
    // `deriveSeed` RE-DERIVES a child's parent from the parent's SLUG at each
    // checkout, so at S(k+1) the child's parent reads `uuid5(new slug)` — a
    // number no row carries, because the transferred row kept `uuid5(old slug)`.
    // Measured on the record rather than reasoned:
    //
    //   the-town/the-unlit-cake   a6cfdfdb-ae34-5778-9c9a-3e733841eb53  (kept)
    //   wright/the-unlit-cake     c4549660-3491-5d91-b48c-699716e9ca13  (derived)
    //   the-town/the-lit-name's `parent` moves from the first to the second
    //
    // `marks.parent uuid REFERENCES marks(id)` (004) is a real, non-deferrable
    // foreign key, so materializing that child's amend does not go wrong quietly
    // — it is REFUSED, mid-era, by the clearing job. This pen says so up front
    // instead, before a connection is opened: a green dry run on a range the
    // store would refuse is the exact falsehood § 9 traded away.
    //
    // RULED (Wright, 2026-09-04, as DEC-16 plumbing): "a claim's `parent`
    // resolves through the STANDING row for the parent's slug, never through
    // uuid5(name) — the same law DEC-16 already gives `supersedes`." Built below;
    // `children` stays as the receipt that says which rows the rule moved.
    t.children = after.marks
      .filter((m) => m.parent && String(m.parent) === uuid5(t.to_slug))
      .map((m) => m.slug);
  }

  // ── A REFERENCE FOLLOWS THE ROW, NOT THE NAME ──────────────────────────────
  //
  // `reidentified` maps the id a checkout DERIVES for a re-identified mark to the
  // id its row actually KEEPS. It is the caller's, threaded across eras and
  // mutated here, because a transfer's consequences outlive its own era: a child
  // added under `wright/the-unlit-cake` three eras later still derives
  // `uuid5("wright/the-unlit-cake")` while the row has carried
  // `uuid5("the-town/the-unlit-cake")` since window 158. Only the caller sees the
  // sequence, so only the caller can own the accumulator.
  //
  // CHAINED on insert, because a mark may change hands twice: if `from` was
  // itself a new name, its entry already points at the original, and this points
  // there too rather than at an intermediate that no row carries either.
  const standingId = (id) => (id == null ? null : (reidentified.get(String(id)) ?? String(id)));
  for (const t of transferred) reidentified.set(uuid5(t.to_slug), standingId(uuid5(t.from_slug)));

  // ── DEC-17: THE HAND IS ASKED OF EVERY ERA, NOT ONLY A DISAGREEING ONE ─────
  //
  // `plantedByHand` was the receipt's DIAGNOSIS: it ran only when a six-count
  // disagreed, because it costs a loader read plus a `git log` per added mark.
  // That was right for a probe explaining a number and is wrong for a ruling:
  // whether a mark is the founder's is a fact about the mark, not about whether
  // its era's arithmetic happened to come out even.
  //
  // MEASURED BEFORE IT WAS BUILT (2026-09-04), because the brief asked whether
  // an era with an agreeing receipt could carry a hand. Across S47 → S55 none
  // does — but TWO ERAS THAT CARRY THE HAND ARE NEVER ASKED AT ALL, and neither
  // is an agreeing one: windows 157 and 158 held NO SWEEP, so their receipt is
  // unchecked (`checked: false`), the diagnosis never ran, and thirteen marks the
  // founder planted derived as pending resident claims with nothing in the run
  // naming them. A gate is not only blind where it disagrees; it is blind where
  // it never looked.
  //
  // The shas are REQUIRED now, and the refusal says so, for the same reason the
  // removals' refusal does: a call that cannot ask the question must not answer
  // it by silence.
  if ((added.length || amended.length) && (!worldRepo || !fromSha || !toSha)) {
    throw new Error(
      `this era carries ${added.length} addition(s) and ${amended.length} amend(s), and DEC-17 asks of each whether ` +
      `the founder's own commit put it in the register — but this call passed no worldRepo/fromSha/toSha to ask git in.`);
  }
  const hand = await plantedByHand({ worldRepo, toDir, fromSha, toSha, added });
  const handAmends = await amendedByHand({ worldRepo, toDir, fromSha, toSha, amended });
  const plantedAt = new Map(hand.map((h) => [h.slug, h]));
  const amendedAt = new Map(handAmends.map((h) => [h.slug, h]));

  // What the rule actually moved, so the run can print it rather than assert it.
  const parentResolved = [];
  const resolveParentId = (m) => {
    const was = m.parent == null ? null : String(m.parent);
    const is = standingId(was);
    if (was !== null && is !== was) parentResolved.push({ slug: m.slug, derived: was, standing: is });
    return is;
  };

  const claim = (m, extra) => ({
    id: extra.id, window_id: window.id, class: m.kind, claimant: m.owner, household: m.household,
    submitted_at: window.opens_at,
    // `pending` stays the default and every resident claim still gets it. Only a
    // claim carrying an admission overrides, and it overrides all three together
    // — a locked status with no `decided_at` would be a decision with no date.
    status: extra.status ?? "pending",
    decided_at: extra.decided_at ?? null,
    body: m.body, geometry: m.geometry, bbox: m.bbox, stake: 0,
    data: extra.data ?? m.data,
    // THROUGH THE ROW, NOT THE NAME (ruled 2026-09-04). `deriveSeed` answers
    // `uuid5(parent slug)` and cannot answer anything else: it reads a checkout,
    // it is shared with `seed-import.mjs`, and it IS the parity oracle — an
    // oracle that consulted the store to fix this column could never disagree
    // with the store about it, which is the one thing an oracle is for. So the
    // reconciliation is here, where the era's transfers are known and the claim
    // is built. Same law as `supersedes` above, one column down.
    parent: resolveParentId(m),
    slug: m.slug, supersedes: extra.supersedes ?? null,
    _mark: m,
  });

  const claims = [
    ...added.map((m) => {
      const h = plantedAt.get(m.slug);
      return claim(m, h ? { id: m.id, ...founderAdmission(m, h) } : { id: m.id });
    }),
    // The mark's id IS its first locking claim's id, so it is what a later claim
    // supersedes — and the FK `claims.supersedes REFERENCES claims(id)` resolves,
    // because the seed wrote that claim row.
    //
    // `was.id`, NOT `mark.id`, and since DEC-16 the difference is real. For an
    // ordinary amend they are the same number, because the slug did not move and
    // both are `uuid5(slug)`. For a mark that ALSO changed hands this era they are
    // not: `mark` is the after-register's row and its id is `uuid5(NEW slug)`, a
    // number no claim in the store carries, so the FK would refuse — and if it
    // somehow did not, the amend would supersede nothing. The rule was always
    // "supersedes the STANDING mark's locking claim"; `was` is the standing mark.
    ...amended.map(({ mark, was }) => {
      const h = amendedAt.get(mark.slug);
      const base = { id: amendId(mark.slug, window.id), supersedes: was.id };
      return claim(mark, h ? { ...base, ...founderAdmission(mark, h) } : base);
    }),
  ].sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));

  for (const t of transferred) t.synthesised = synthesisedTransfer({ ...t, window });

  // The hand is NOT hung on the `added` / `amended` entries themselves, and that
  // is a measurement rather than a taste: `added` holds the very objects in
  // `after.marks`, which is returned below as `registerAfter` and IS the parity
  // oracle. Annotating them would write our finding onto the thing we compare
  // against. So the hand rides beside them, keyed by slug.
  return {
    claims, added, amended, retired, transferred, hand, handAmends, parentResolved, reidentified,
    unruled: retired.filter(isUnruled), registerAfter: after, registerBefore: before,
  };
}

/**
 * A DEPARTURE DEC-15 DID NOT RULE ON. It refuses at the WRITE, not at derivation.
 *
 * DEC-15 is a ruling about ONE transition — a standing mark that leaves the
 * register — and the first full-range dry run turned up two shapes wearing that
 * one description:
 *
 *   `the-town/pledges`      the file was DELETED (founder commit 6b235216d). The
 *                           record left canon. That is the retirement DEC-15 ruled.
 *   `the-town/the-lit-name` the file was MODIFIED — world 17103dc37, 2026-08-31,
 *                           "the Lit Name passes to wright … restake on
 *                           wright/the-lit-name owed after the next crossing
 *                           REFOLDS THE ID". `by:` changed, and since a mark's id
 *                           is `by + leaf` (marks-fold § walkMarks) the slug moved
 *                           with it. The record never left canon; it changed hands.
 *
 * Calling the second one a retirement would put a `withdraw` in the log for a mark
 * nobody withdrew and would retire a row whose record is still standing three
 * directories away — the invention DEC-15 spent a paragraph not being. And 2.0
 * has no word for it yet: `marks.slug` is the identity and `uuid5(slug)` the id,
 * so a re-identification is a new row and an orphaned old one, which is a RULING
 * about ownership transfer and not a thing a replay may decide on its own.
 *
 * SO THE REFUSAL MOVED RATHER THAN LEAVING. The old code threw inside `eraClaims`,
 * which meant the very first unruled departure hid every one after it — the S47 →
 * S55 dry run stopped at S51 and told the founder about one mark when there were
 * two shapes to rule on. Derivation now CLASSIFIES all of them and the write
 * refuses; `--dry-run` exits non-zero and names them. "The refusal exists so that
 * the first one is seen" — and a refusal that shows the founder the whole class
 * sees it better than one that shows him its first member.
 */
export const isUnruled = (r) => r.case === "unruled";

// ── DEC-15's three small facts: the act's object, the mark's file, the hand ───

/**
 * The slug an act names.
 *
 * BOTH SPELLINGS, because the two pens that write this table spell it in two
 * places and only one of them is the column. `deriveActs` sets `object` NULL by
 * design and carries the whole original event in `payload` (its documented
 * shallowness), and the town's pen rows state `object` at the TOP LEVEL of that
 * event — verified against the real log: a `withdraw` line is
 * `{"at":…,"type":"withdraw","actor":"neth","class":"mark","object":"neth/test-verify",…}`.
 * A `departure` nests its own fields under `payload` instead, which is why
 * `deriveActs` reads `payload.crossing` there and finds nothing here. So an act
 * arriving from `insertActs`' own row shape answers on `object`, and one arriving
 * from `deriveActs` answers on `payload.object`, and this asks both rather than
 * betting on which side of the seam the caller is standing.
 */
export const actObject = (a) => a?.object ?? a?.payload?.object ?? null;

/** `legacy:withdraw` and `withdraw` are the same verb — `actDedupeKey`'s rule, reused. */
export const isWithdrawAct = (a) => String(a?.action ?? "").replace(/^legacy:/, "") === "withdraw";

/**
 * Where each mark's record lives in this checkout, asked of the CHECKOUT'S OWN
 * LOADER — seed-import's `readersOf` technique and its reason, one file over:
 * "the code that parses sha X is the code that shipped at sha X."
 *
 * It has to be the loader and not a rule of ours, because a mark's slug is NOT
 * its path. `the-town/pledges` is filed at
 * `WORLD/marks/let-there-be-light/the-town-centre/the-bounty-board/pledges/mark.md`
 * — `id = by + leaf`, and everything between is the historical filing that
 * `WORLD/filing-freeze.json` retired as a claim. Any slug→path rule we wrote here
 * would be a second copy of `walkMarks`, drifting silently, which is the class
 * gold § 3 rule 5 forbids. The loader already states it: `rec._dir`.
 */
async function markFilingAt(worldDir) {
  return new Map([...(await filingOwners(worldDir))].map(([path, id]) => [id, path]));
}

/** The same reading the other way: which id stands at each file, in this checkout. */
async function filingOwners(worldDir) {
  const repo = resolve(worldDir);
  const { loadMarks } = await import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);
  const out = new Map();
  for (const rec of loadMarks(join(repo, "WORLD", "marks"))) {
    if (!rec?.id || !rec?._dir) continue;              // a reader that files no directories states no path
    out.set(`${relative(repo, rec._dir).split(sep).join("/")}/mark.md`, rec.id);
  }
  return out;
}

/**
 * The commit that deleted a mark's file inside this era, and what its author said.
 *
 * `--diff-filter=D` over the era's range, newest first, one result: the hand that
 * took the record out of canon. `%x1f` separates the three fields because a commit
 * SUBJECT may contain anything a founder types, `|` and `\t` included — the
 * three-asks subject that removed `the-town/pledges` is 500 characters of prose
 * with semicolons and parentheses in it.
 */
const UNIT_SEP = String.fromCharCode(0x1f);

export function commitTouching(worldRepo, { fromSha, toSha, path, filter }) {
  const out = git(worldRepo, "log", `--diff-filter=${filter}`, "--format=%H%x1f%cI%x1f%s", "-1",
    `${fromSha}..${toSha}`, "--", path);
  if (!out) return null;
  const [sha, at, subject] = out.split("\n")[0].split(UNIT_SEP);
  return { sha, at: new Date(at).toISOString(), subject };
}

/** DEC-15's hand: the commit that DELETED the record. */
export const removingCommit = (worldRepo, opts) => commitTouching(worldRepo, { ...opts, filter: "D" });

/**
 * EVERY MARK FILE THE ERA MOVED — the rename half of DEC-16's tell (M-8).
 *
 * DEC-16 asks "is the file still at its old path under a new id?", which is the
 * whole tell for `the-town/the-lit-name`, whose file never moved. It is not the
 * whole tell for the record. `61c5fdfbc` — "the cake, the vault, and the cellar
 * door PASS FROM THE-TOWN TO WRIGHT" — is a git RENAME: the file moved to the new
 * owner's path AND its `by:` changed in the same commit. Path identity cannot see
 * it, so three records changing hands read as three retirements plus three
 * additions, and the escrow and by-id history DEC-16 exists to preserve are lost
 * under three orphaned ids. Ruled (Wright, 2026-09-04, as plumbing under DEC-16):
 * the tell is path identity OR a rename.
 *
 * ASKED ONCE PER ERA OVER THE WHOLE `WORLD/marks` TREE, not once per departure,
 * and that is not only a cost decision — it is the only way that works. Git
 * detects a rename by comparing the two SIDES of a diff, so a pathspec naming the
 * old path alone finds nothing: the new path is outside it and there is nothing
 * to pair with. Measured, both ways, before this was written.
 *
 * Returns `Map(oldPath -> { to, sha, at, subject, score })`. `score` is git's own
 * similarity index (R100 = byte-identical, R096 = the `by:` line and nothing
 * else), carried because it is the record's own statement of how much of the file
 * moved unchanged and a reader should not have to re-run git to see it.
 */
export function renamesBetween(worldRepo, { fromSha, toSha }) {
  const out = git(worldRepo, "log", "--diff-filter=R", "--find-renames", "--name-status",
    `--format=C${UNIT_SEP}%H${UNIT_SEP}%cI${UNIT_SEP}%s`, `${fromSha}..${toSha}`, "--", "WORLD/marks");
  const renames = new Map();
  let commit = null;
  for (const line of out.split("\n")) {
    if (line.startsWith(`C${UNIT_SEP}`)) {
      const [, sha, at, subject] = line.split(UNIT_SEP);
      commit = { sha, at: new Date(at).toISOString(), subject };
      continue;
    }
    if (!commit || !line.startsWith("R")) continue;
    const [score, from, to] = line.split("\t");
    if (!from || !to) continue;
    // FIRST WRITER WINS. The walk is newest-first, so an older commit that moved
    // the same path must not overwrite the move that actually landed it where it
    // now stands. (A path renamed twice inside one era is not in this range; the
    // rule is stated because the loop order alone would decide it silently.)
    if (!renames.has(from)) renames.set(from, { to, score, ...commit });
  }
  return renames;
}

/** The leaf directory a mark's file sits in — `.../<leaf>/mark.md`. */
const leafOf = (p) => (p ?? "").split("/").slice(-2, -1)[0] ?? null;

/**
 * WHICH OF AN ERA'S ADDITIONS NOBODY PUBLISHED — the receipt's diagnosis (F-5).
 *
 * A six-count that disagrees is a finding, and "the era boundary is wrong" was
 * the first guess. It was the wrong guess, and this is the probe that says so.
 * Between `08689e81` and `69b2d442` the sweep's own receipt reads `9 published`
 * while the replay derives 36 — and thirty mark FILES are added in that range by
 * commits that are not sweeps at all: `243cc57` alone plants twenty-two ("civic
 * quarter: the law the five plaques used to say returns as predicated children
 * (22 marks)"). The founder put them in the register by hand, on `main`. No door
 * saw them, no sweep published them, and the six-count never counted them.
 *
 * That is the exact MIRROR of DEC-15 case (b), which ruled the founder's
 * REMOVALS. His ADDITIONS are unruled, and the replay currently reads each one as
 * a resident's CLAIM — a pending row for the clearing job to adjudicate as though
 * somebody filed it in that window. This function does not decide that; it counts
 * it, so the receipt says WHY it disagrees instead of leaving a number hanging.
 *
 * Only asked when a receipt disagrees: it costs a loader read plus one `git log`
 * per added mark, which is not a price every green era should pay.
 */
export async function plantedByHand({ worldRepo, toDir, fromSha, toSha, added }) {
  return byHand({ worldRepo, toDir, fromSha, toSha, filter: "A", slugs: added.map((m) => m.slug) });
}

/**
 * THE THIRD FACE OF THE SAME HAND — and it closes the accounting (F-5, evening).
 *
 * `plantedByHand` explained most of each receipt gap and left four small
 * remainders (4, 3, 5, 1 claims across four eras). They are not a fourth shape.
 * They are the founder AMENDING an existing mark on `main`, and counting them
 * makes every disagreeing era add up EXACTLY:
 *
 *     derived = the sweeps' own published + additions by hand + amends by hand
 *
 *   publish/eb67b7d4   1 + 3 + 4 =  8   ✓
 *   publish/c1f26410   7 + 4 + 3 = 14   ✓
 *   publish/69b2d442   9 + 22 + 5 = 36  ✓
 *   publish/a8fe0e35   5 + 0 + 1 =  6   ✓
 *
 * So the founder's hand on `main` has three faces and they are the same act:
 * REMOVE a record (DEC-15, ruled), ADD one (DEC-17, proposed), AMEND one (this —
 * unnamed). One commit does all three: `6b235216d`, the three-asks ruling, is
 * where DEC-15's `the-town/pledges` removal came from, and it also amends
 * `the-town/the-bounty-board` and `wright/furnish-ferrys-waiting-room`. DEC-15
 * ruled a third of that commit.
 *
 * Counted here, not decided. An amend by hand is currently derived as a resident's
 * amend claim carrying `supersedes` — a claim the clearing job will adjudicate as
 * though a resident filed it.
 */
export async function amendedByHand({ worldRepo, toDir, fromSha, toSha, amended }) {
  return byHand({
    worldRepo, toDir, fromSha, toSha, filter: "M",
    slugs: amended.map((a) => a.mark.slug),
    // ── M-10: A RENAME-TRANSFER'S EDIT HALF, ADMITTED ───────────────────────
    //
    // This probe asks `--diff-filter=M` at the mark's CURRENT path, and a
    // rename does not register as a modification there — git files the change
    // under R, against a path pair, and a pathspec naming one side alone has
    // nothing to pair with. So the founder's hand was invisible on exactly the
    // commits that both MOVED a record and EDITED it, and the edit half of a
    // rename-transfer was derived as a resident's ordinary amend claim: pending,
    // for the candle to adjudicate. `wright/the-candle-vault` is the live case.
    //
    // It reached the right answer anyway, through the transfer — the clearing
    // job's step 1 finds a standing mark at the new slug whose id IS the claim's
    // `supersedes`, so it locks as an amend rather than refusing as a duplicate.
    // That is why this was "not a blocker" and not why it was safe: a claim that
    // arrives at the right verdict by way of a judgement is a claim a judgement
    // can REFUSE, which is the residual exposure DEC-17 exists to remove.
    //
    // THE COMMIT WAS ALREADY IN HAND, which is why the fix is a lookup and not
    // another `git log`. `eraClaims` builds each transfer from `renamesBetween`,
    // whose map carries the sha, the date and the subject of the very commit
    // that moved the file — and that function's own words, one screen up, are
    // the law this reuses rather than a new idea: "A rename ALREADY NAMED ITS
    // COMMIT … asking git a second time would be a second reading of one fact,
    // and the two could differ."
    //
    // Passed for every transfer, not only the renamed ones. A same-path refold's
    // `commit` IS `commitTouching(…, filter: "M")` at that same path — the
    // identical call this loop would make — so handing it over changes nothing
    // there and spares a duplicate read. The publish-subject guard below still
    // runs on it: a commit that published is not the founder's hand, however
    // this probe came by it.
    known: new Map(amended.filter((a) => a.transfer?.commit?.sha)
      .map((a) => [a.mark.slug, a.transfer.commit])),
  });
}

async function byHand({ worldRepo, toDir, fromSha, toSha, filter, slugs, known = new Map() }) {
  if (!slugs.length) return [];
  const owners = await filingOwners(toDir);
  const pathOf = new Map([...owners].map(([p, id]) => [id, p]));
  const hand = [];
  for (const slug of slugs) {
    // A commit the caller already holds is used as it stands. Only when there is
    // none does this ask git, and only then does a missing file mean there is
    // nothing to ask about.
    const carried = known.get(slug) ?? null;
    const path = pathOf.get(slug);
    if (!carried && !path) continue;           // no file to ask about; not a claim about the hand
    const c = carried ?? commitTouching(worldRepo, { fromSha, toSha, path, filter });
    // `at` RIDES SINCE DEC-17. It was dropped here while the hand was only a
    // count for the receipt's diagnosis; the admission needs it, because a claim
    // the founder's hand locked is decided WHEN HIS COMMIT LANDED and not at
    // replay time. `commitTouching` has carried it all along.
    if (c && !PUBLISH_SUBJECT.test(c.subject)) hand.push({ slug, sha: c.sha, subject: c.subject, at: c.at });
  }
  return hand;
}

/**
 * THE ADMISSION A FOUNDER'S COMMIT MAKES (DEC-17, RULED 2026-09-04).
 *
 * Verbatim, and it is the ruling this function implements:
 *
 *   "A founder's hand on main is an ADMISSION in every face — an added mark
 *    materialises directly (a claim LOCKED at that window by the founder's hand
 *    naming the commit, the mark standing), an amended mark supersedes directly
 *    (the same locked shape, `supersedes` the standing one), a removed mark
 *    retires (DEC-15). The clearing job never re-judges canon."
 *
 * WHERE THE PROVENANCE LIVES, and why not `claims.ruling`. 009 gives `claims` a
 * `ruling` column and its own COMMENT says what it is for: "the REVIEW lane's
 * receipt … a fact about a contest a mind was asked to settle, not a field every
 * claim has". An admission is not a contest and no mind was asked. So it goes in
 * `data`, which 004 added as the record's remainder and which
 * `materializeClaims` already copies onto the mark — so the row and the claim
 * carry the same sentence without a second write saying it twice.
 *
 * `decided_at` IS THE COMMIT'S TIME, not `now()`. `clearing-job.mjs` writes
 * `now()` because a candle decides when it burns; this claim was decided when
 * the founder's commit landed, months of replay ago, and a replay that stamped
 * itself would make every admission look like it happened tonight.
 */
export const founderAdmission = (m, hand) => ({
  status: "locked",
  decided_at: hand.at,
  data: {
    ...(m.data ?? {}),
    locked_by: "founder",
    founder_commit: { sha: hand.sha, subject: hand.subject, at: hand.at },
  },
});

/**
 * The two 2.0-only keys a founder admission puts in `marks.data`, plus DEC-16's.
 *
 * 1.0's mark file cannot carry any of them: `formerly` is the list of names a
 * record has worn (DEC-16), and these two are how the row got here (DEC-17).
 * `parityFindings` compares `marks.data` against the checkout's, so without this
 * list every re-identified and every admitted mark would be reported as "a
 * `data` that differs beyond tier" — the line that exists to catch a
 * MATERIALIZER LOSING PART OF THE RECORD. Ninety-two rows of known-good
 * provenance in it would bury the one row that matters.
 *
 * NAMED, NOT SILENTLY FILTERED, and counted in `provenance` beside the verdict —
 * the same contract `standingOnly` is held to. What remains after removing them
 * is still compared, so a materializer that dropped `date` or `image` still
 * lands in `otherData` exactly as before.
 */
export const REPLAY_ONLY_DATA_KEYS = ["formerly", "locked_by", "founder_commit"];

/**
 * The `transfer` the founder's commit never wrote (DEC-16).
 *
 * Same shape and same reasons as `synthesisedWithdraw` — an act by `the-town`,
 * timed to the commit, spelled BARE so `actsCompleteness` (which counts
 * `legacy:%` against the checkout's STATE/log census) does not read it as an
 * over-carried row, and marked `_synthesised` so a reader knows no door wrote it.
 *
 * `object` IS THE NEW SLUG. `acts.object` is how a mark's history is found
 * (`acts_object_idx`), and the row this act explains is, from the moment the act
 * lands, the new one. The old name is not lost — it is in `payload.from_slug`,
 * and it is in `data.formerly` on the row itself, which is the durable copy.
 *
 * `payload.retired_by` carries the commit's sha because DEC-16 names that key,
 * and one key meaning "the commit whose hand did this" reads the same across both
 * synthesised acts. The word is a poor fit here — nothing is retired by a
 * transfer — and that is reported to the founder rather than renamed by this pen.
 */
export function synthesisedTransfer({ from_slug, to_slug, window, commit }) {
  return {
    at: commit.at, crossing: window.id, actor: "the-town", action: "transfer", object: to_slug,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: "mark",
    payload: {
      type: "transfer", at: commit.at, actor: "the-town", class: "mark", object: to_slug,
      crossing: window.id, from_slug, to_slug, retired_by: commit.sha, subject: commit.subject,
      _synthesised: "world2/tools/replay-ingest.mjs · DEC-16 re-identification — the record changed hands on main",
    },
    effect: null, household: null, journal_seq: null,
  };
}

/**
 * The `withdraw` the founder's commit never wrote, written for it (DEC-15 case b).
 *
 * "The record leaves canon, its whole life stays in the log" (founder-ruled
 * 2026-08-19). A removal on `main` passed no door, so the log has no event that
 * explains why the register lost a row — and a store whose `marks` says `retired`
 * with nothing in `acts` to point at is precisely the half-record the 08-19 rule
 * is against. This is the other half, and every field of it is a fact of the
 * record rather than a choice: the actor is `the-town` because the town's own
 * hand is what moved, the time is when the commit landed, and `retired_by` is the
 * sha a reader can go and check.
 *
 * THE ACTION IS SPELLED BARE — `withdraw`, not `legacy:withdraw` — and the reason
 * is `actsCompleteness`. That check counts `action LIKE 'legacy:%'` rows per
 * crossing against the checkout's own STATE/log census, and this row is in no
 * log: spelling it `legacy:` would make every era carrying a founder removal read
 * as one act OVER-carried, a red manufactured by our own bookkeeping. The bare
 * verb is also the true one — this is not a photograph of a 1.0 log row, it is
 * 2.0's own act — and `actDedupeKey` strips the prefix anyway, so the dedupe sees
 * the two spellings as one act regardless.
 *
 * `_synthesised` is on the payload so the row says out loud that no resident and
 * no door wrote it. A synthesised act that looked exactly like a witnessed one
 * would be the reading this whole tool refuses to make.
 */
export function synthesisedWithdraw({ slug, window, commit }) {
  return {
    at: commit.at, crossing: window.id, actor: "the-town", action: "withdraw", object: slug,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: "mark",
    payload: {
      type: "withdraw", at: commit.at, actor: "the-town", class: "mark", object: slug,
      crossing: window.id, retired_by: commit.sha, subject: commit.subject,
      _synthesised: "world2/tools/replay-ingest.mjs · DEC-15 case (b) — no door wrote this; a commit on main did",
    },
    effect: null, household: null, journal_seq: null,
  };
}

/**
 * THE DOOR'S OWN WITNESS, held against the claim set derived from the settlement.
 *
 * The two halves of this replay come from places that know nothing about each
 * other: the CLAIMS are derived from the settlement's outcome (what the register
 * gained), and the ACTS are the town's journal (what a resident did at the door).
 * Where the journal happens to carry a `leave-mark`, the two must name the same
 * mark — an independent corroboration that the outcome-derived claim set is the
 * set of things people actually submitted, not a shape we imposed on the diff.
 *
 * It is REPORTED, not gated, and the asymmetry is the reason. A `leave-mark` with
 * no claim in this era is the six-count's `left_drafted` — a draft that stood in
 * the live layer and did not publish, which is a normal outcome and is exactly
 * what the act's own `effect` says ("a draft stands in the live layer; it enters
 * canon at the next crossing that ratifies it"). And most eras carry NO
 * leave-mark acts at all, because they lived in the office's sqlite journal and
 * only reach the world repo when a window is hand-drained into it. So the honest
 * statement is a coverage count with the unmatched named, not a verdict.
 */
export function doorWitness({ acts, claims }) {
  const submitted = new Set(claims.map((c) => c.slug));
  const marks = acts.rows.filter((a) => a.action === "legacy:leave-mark");
  const named = marks.map((a) => ({ slug: a.payload?.object ?? null, actor: a.actor, at: a.at }));
  const matched = named.filter((n) => n.slug && submitted.has(n.slug));
  const unmatched = named.filter((n) => !n.slug || !submitted.has(n.slug));
  return { total: named.length, matched, unmatched };
}

// ── the window ───────────────────────────────────────────────────────────────

/**
 * The era's window, discovered from the checkout — `genesisWindow`'s rule, reused.
 *
 * "The crossing NUMBER is the window id — the town's clock survives"
 * (001_tables.sql). The seed read the highest `STATE/log/<N>.jsonl` at the frozen
 * tag and got 150; each settlement after it advances that number by one, and the
 * store's OPEN window has to be it. If the two disagree, the replay is being
 * pointed at a store that is not where its checkout says it is, and it refuses —
 * the seed's `--tag` guard, one lane over.
 *
 * `closes_at` is the settlement commit's date, because that is when the town
 * actually ruled the window. `opens_at` is not chosen at all: the store's open
 * window already carries it, put there by its predecessor's close, and
 * 005_candle_tiling's trigger will not let it be anything else.
 */
export function eraWindow({ toDir, lawSha, townSha }) {
  const w = genesisWindow({ repo: toDir, lawSha, townSha });
  return { ...w, status: "open", cleared_at: null, receipts: null };
}

// ── the write: the era's acts and its pending docket ─────────────────────────

const CHUNK = 500;

// ── THE PEN'S OWN ROWS ARE ALREADY IN THE STORE (the flip's seam, 2026-09-03) ─
//
// From w2-hold-say-flip-report.md § Gate 5 item 2, verbatim: "`world-drain`'s
// logs half photographs EVERY row into `STATE/log/<crossing>.jsonl` at the
// crossing-save. So the public world repo's log gains say/holding lines it never
// carried. ⚠ The consumer that assumes otherwise: `replay-ingest` (a) 'the era's
// STATE/log rows become `acts`' via `deriveActs` (journal_seq NULL, no dedupe
// against the pen's rows). At F1 (cutover-eve replay-parity) a flipped-era row
// would be derived a second time."
//
// It is the STANCE lane's seam too, since 2026-09-02, and it widens with every
// lane that flips. `deriveActs` reads a photograph of the journal; a flipped
// lane's journal row is the REVERSE MIRROR of an act Postgres already holds. So
// after a flip, one act exists twice in the sources this tool reads, and without
// this dedupe the replay would write it twice — silently, because `acts` is
// append-only and has no uniqueness the store could refuse on.
//
// THE DROPPED ALTERNATIVE, and why: have the drain skip flipped lanes' rows.
// That keeps the ingest naive at the cost of tearing holes in 1.0's photograph —
// the public record of the town would stop carrying what residents said. The
// report's recommendation was "dedupe in replay; the photograph stays whole",
// and this is that.

/**
 * THE KEY, AND THE ONE NORMALIZATION IT MAKES.
 *
 * (actor, action, written_at) — the lane-closure way, quoted from that
 * falsifier's matcher rather than reinvented, and the shape the flip report
 * teed.
 *
 * `legacy:` IS STRIPPED, and that is the whole reason a naive key would not
 * work. `deriveActs` spells a derived row's action `legacy:<type>` ("a census
 * keeps 2,400 imported rows from voting in a vocabulary they predate"), while
 * the pen writes the verb bare — `say`, `take`, `declare-stance-on`. The two
 * spellings ARE the same act; a key that did not know that would call every
 * flipped-era row fresh and insert it, which is the defect. Stripping on both
 * sides also makes the key idempotent against a store that already holds
 * previously-derived `legacy:` rows.
 *
 * `object` is deliberately NOT in the key. The drain photographs it and
 * `deriveActs` sets it NULL by design (the log states an emission's own id, not
 * a thing acted upon), so including it would make every pair miss. Actor +
 * action + instant is already tight: two acts by one actor of one verb in the
 * same millisecond are one act, and the town's clock has never produced
 * otherwise. If it ever does, this dedupe would drop a real row — so the count
 * it reports is not decoration, it is the number an operator checks.
 */
export const actDedupeKey = (actor, action, at) => JSON.stringify([
  String(actor),
  String(action).replace(/^legacy:/, ""),
  new Date(at).toISOString(),
]);

/**
 * Split derived rows into the ones the store does not have and the ones it does.
 *
 * Pure, and separately testable for that reason: the DB half of this tool is
 * proved on the box, but WHICH ROWS ARE DUPLICATES is a decision that must be
 * readable without a database (test/world2-replay-ingest.test.mjs's own contract).
 *
 * Duplicates WITHIN `rows` are kept, all of them. The multiset difference in
 * `eraActs` exists because "the town's record genuinely repeats a row (the
 * frozen walk ledger carries one departure twice, byte for byte)" — collapsing
 * those here would undo AB-P3's lesson one file over. This skips only what the
 * STORE already holds.
 */
export function partitionNewActs(rows, existingKeys) {
  const fresh = [];
  const skipped = [];
  for (const a of rows) {
    if (existingKeys.has(actDedupeKey(a.actor, a.action, a.at))) skipped.push(a);
    else fresh.push(a);
  }
  const byAction = {};
  for (const a of skipped) byAction[a.action] = (byAction[a.action] ?? 0) + 1;
  return { fresh, skipped, byAction };
}

/**
 * The keys `acts` already holds for the instants these rows cover.
 *
 * Bounded by the rows' own time span rather than reading the whole table: the
 * store carries ~3,000 legacy rows and grows, and an era is tens. The bound is
 * the min/max of the batch, inclusive, so a row cannot be missed by it.
 */
export async function existingActKeys(client, rows) {
  const keys = new Set();
  if (!rows.length) return keys;
  const times = rows.map((a) => new Date(a.at).toISOString()).sort();
  const { rows: have } = await client.query(
    "SELECT actor, action, at FROM acts WHERE at >= $1 AND at <= $2", [times[0], times[times.length - 1]]);
  for (const h of have) keys.add(actDedupeKey(h.actor, h.action, h.at));
  return keys;
}

/**
 * Insert the era's acts, skipping what the store already holds.
 *
 * Returns `{ inserted, skipped, byAction }` — a count, not a silence. A dedupe
 * that reported nothing would be indistinguishable from a derivation that came
 * up short, and the number of rows the pen already wrote for an era is exactly
 * the number an operator needs to sanity-check against that era's flipped lanes.
 */
export async function insertActs(client, rows) {
  const existing = await existingActKeys(client, rows);
  const { fresh, skipped, byAction } = partitionNewActs(rows, existing);
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const slice = fresh.slice(i, i + CHUNK);
    const values = []; const params = [];
    slice.forEach((a, n) => {
      const b = n * 13;
      values.push(`(${Array.from({ length: 13 }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy,
        a.witnesses, a.class, JSON.stringify(a.payload), a.effect, a.household);
    });
    await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                         witnesses, class, payload, effect, household)
       VALUES ${values.join(", ")}`, params);
  }
  return { inserted: fresh.length, skipped: skipped.length, byAction };
}

/**
 * The pending docket for one window.
 *
 * `slug` is a COLUMN (006), and this is the pen that asked for it. Before 006 the
 * only place a claim could name the mark it was for was inside `geometry` —
 * `clearing-job.mjs` read `geometry->>'slug'` — which put a mark's identity inside
 * the column documented as "the 1.0 mark frontmatter shape" and gave a DE-SITED
 * claim nowhere to put it at all. The first pass of this replay wrote the slug
 * there because that was the only door, reported the 14 marks that came out
 * carrying their own slug in their geometry, and reported the one predicated claim
 * that locked and materialized nothing. 006 is the answer to both.
 *
 * `geometry` is now exactly what the checkout derived, so a materialized mark's
 * geometry can be compared to 1.0's without anything of ours in it.
 */
export async function insertClaims(client, claims) {
  for (const c of claims) {
    // `status` AND `decided_at` COME FROM THE CLAIM SINCE DEC-17. They used to be
    // `'pending'` written literally into the INSERT, which was true of every
    // claim a replay could derive until a founder's admission arrived already
    // decided. The default has not moved — `eraClaims` still stamps `pending` on
    // every resident claim — but it is now the DERIVATION's default and not the
    // writer's, so the one place that decides a claim's status is the one place
    // that knows why.
    //
    // It is INSERTed locked rather than inserted pending and updated: 002's
    // `claims_update_guard` exempts only `clearing_job`, and this pen connects as
    // `world2_owner`, so an UPDATE here would raise. The guard is right and the
    // INSERT is the honest door.
    await client.query(
      `INSERT INTO claims (id, window_id, slug, class, claimant, household, submitted_at, status, decided_at,
                           body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.id, c.window_id, c.slug, c.class, c.claimant, c.household, c.submitted_at,
        c.status ?? "pending", c.decided_at ?? null,
        c.body, c.geometry ? JSON.stringify(c.geometry) : null, c.bbox, c.stake,
        JSON.stringify(c.data), c.parent, c.supersedes]);
  }
}

// ── the parity check ─────────────────────────────────────────────────────────

// What the world IS. The gate.
export const SUBSTANCE_COLUMNS = ["kind", "owner", "household", "body", "geometry", "bbox", "status"];

const MARKS_SELECT =
  `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status,
          locked_window, data, parent::text
     FROM marks ORDER BY slug`;

/**
 * THE HALF THE GATE COMPARES (DEC-15) — the store's STANDING register.
 *
 * 1.0's register is a set of files, and a file that is gone is gone: there is no
 * row in `deriveSeed`'s output for a retired mark, and there cannot be. 2.0 keeps
 * the row and flips `status`, because "its whole life stays in the log" and the
 * mark's id is what a later claim supersedes. Those two are the SAME register
 * said two ways, and comparing them without this filter would report every
 * lawfully retired mark as EXTRA in DB — a red manufactured by the ruling that
 * made the era replayable, which is the worst kind.
 *
 * It is done here rather than in the SQL on purpose: WHICH ROWS THE GATE SEES is
 * a decision, and a decision that only exists inside a query string cannot be
 * asked a question without a database. This one can (the test feeds it both
 * shapes), which is the same contract `partitionNewActs` is held to.
 *
 * The two directions the gate still refuses, unchanged:
 *   - a retired store row the register STILL CARRIES → MISSING in DB → RED. The
 *     replay retired something 1.0 never removed.
 *   - a standing store row the register lacks → EXTRA in DB → RED, as today.
 */
export const standingOnly = (rows) => rows.filter((r) => r.status === "standing");

/**
 * Does 2.0's standing register say what 1.0's says at this settlement's tag?
 *
 * The oracle is `deriveSeed` at S(k) — 1.0's register read by 1.0's own loader
 * and fold at that sha ("the code that parses sha X is the code that shipped at
 * sha X"), which is the same oracle the seed was verified against. The comparator
 * is `compareMarks`, also the seed's. Nothing about "the DB agrees with the
 * checkout" is written twice.
 *
 * `geometry` is compared with the slug the clearing job smuggled into it removed
 * first — otherwise every replayed mark would report drift on a key WE put there
 * to satisfy the materializer, which would be a finding manufactured by a
 * workaround and would hide the real ones behind it. The gap itself is reported
 * separately, by name and by count, in `provenance`.
 */
export async function parityFindings(client, { registerAfter }) {
  const all = (await client.query(MARKS_SELECT)).rows;
  const db = standingOnly(all).map((r) => ({
    ...r,
    geometry: stripSlug(r.geometry),
  }));
  const substance = compareMarks(db, registerAfter.marks, { columns: SUBSTANCE_COLUMNS });

  // PROVENANCE — reported, never gated, never dropped. Separate questions, kept
  // separate because they have different answers.
  //
  // THE STALE STANDING IS NO LONGER ONE OF THEM. It was provenance while it was
  // unruled ("Standing goes stale, and that one is not fixed … NEEDS A RULING");
  // Wright ruled it 2026-08-28 eve — "tier = recompute-at-close … the replay gate
  // is the judge" — and a judge that only makes a note is not a judge. It joins
  // `substance` below, in compareMarks' own voice, and the gate goes red on it.
  const provenance = [];
  const { noData, staleTier, otherData, missingParent, replayOnly } = dataFindings(db, registerAfter.marks);
  const slugInGeometry = (await client.query("SELECT slug FROM marks WHERE geometry ? 'slug'")).rows.map((r) => r.slug);

  if (noData.length)
    provenance.push(`${noData.length} mark(s) carry no \`data\` at all — the record's remainder (date, image, ` +
      `slot, tier) that 004 gave marks a column for, e.g. ${noData.slice(0, 4).join(", ")}`);
  if (otherData.length)
    provenance.push(`${otherData.length} mark(s) carry a \`data\` that differs from the checkout's beyond tier, ` +
      `e.g. ${otherData.slice(0, 4).join(", ")}`);
  if (replayOnly.length)
    provenance.push(`${replayOnly.length} mark(s) carry 2.0-only \`data\` keys 1.0's file cannot have and which are ` +
      `therefore NOT compared — \`formerly\` (DEC-16, the names a record has worn) and \`locked_by\`/` +
      `\`founder_commit\` (DEC-17, the founder's hand that admitted it). Everything else in \`data\` is still ` +
      `compared, so a materializer that lost part of the record still lands above: ${replayOnly.slice(0, 4).join(", ")}`);
  if (missingParent.length)
    provenance.push(`${missingParent.length} mark(s) lost the continuation edge \`parent\`, e.g. ${missingParent.slice(0, 4).join(", ")}`);
  if (slugInGeometry.length)
    provenance.push(`${slugInGeometry.length} mark(s) carry their own slug inside \`geometry\` — the pre-006 ` +
      `identity, which the clearing job had nowhere else to read from, e.g. ${slugInGeometry.slice(0, 4).join(", ")}`);

  // REPORTED, never gated, and named rather than merely filtered. `standingOnly`
  // takes these rows out of the comparison; a filter nobody can see is how a
  // count goes quietly wrong, so the number the gate stopped comparing is stated
  // beside the verdict it is not part of.
  const retiredRows = all.filter((r) => r.status === "retired");
  if (retiredRows.length)
    provenance.push(`${retiredRows.length} mark(s) stand RETIRED and are absent from 1.0's register by DEC-15 — ` +
      `terminal supersession, compared as absent, their life in \`acts\`: ${retiredRows.slice(0, 4).map((r) => r.slug).join(", ")}`);

  return { substance: [...substance, ...staleTier], provenance };
}

/**
 * Take the pre-006 smuggled slug back out of a store row's `geometry`.
 *
 * THE STRIP THAT EMPTIES THE OBJECT MUST SAY `null`, NOT `{}` (DEC-18).
 *
 * A DE-SITED mark has no geometry at all, so the slug the clearing job smuggled
 * in is its ONLY key, and stripping it left `{}` — compared against the
 * register's `null`, which `canonicalJson` renders as two different strings. The
 * comment on `parityFindings` says this strip exists so that no finding is
 * "manufactured by a workaround"; until now it manufactured one per de-sited
 * continuation mark (nine at S58: the `welcome-*` marks, `quill-stem/the-fitting-room`,
 * `sable/the-second-failed-lap`, `vermillion/pando-peak-home`). They were never a
 * store defect and there was never anything to backfill for them.
 *
 * Narrow on purpose: only the branch that actually removed a slug can empty an
 * object this way. A store row whose geometry is genuinely `{}` — no slug ever in
 * it — is returned untouched and still reds against a register `null`, because
 * that is a real disagreement about a real column and not this one's shape.
 */
// EXPORTED so it can be asked a question. Same contract `standingOnly` is held
// to two functions up: "WHICH ROWS THE GATE SEES is a decision, and a decision
// that only exists inside a query string cannot be asked a question without a
// database." What this returns for an emptied object is a decision of exactly
// that kind, and it was wrong for nine rows for as long as it was unaskable.
export const stripSlug = (g) => {
  if (!g || typeof g !== "object") return g;
  if (!("slug" in g)) return g;
  const { slug, ...rest } = g;                 // eslint-disable-line no-unused-vars
  return Object.keys(rest).length ? rest : null;
};

const without = (o, keys) => {
  const out = {};
  for (const [k, v] of Object.entries(o ?? {})) if (!keys.includes(k)) out[k] = v;
  return out;
};

/**
 * WHAT `marks.data` SAYS THAT THE CHECKOUT'S RECORD DOES NOT — the four classes.
 *
 * Extracted from `parityFindings` by DEC-17 for the reason `standingOnly` was
 * exported by DEC-15: this is a DECISION about what the gate compares, and a
 * decision that only exists inside a function holding a database connection
 * cannot be asked a question. It is pure, so a test can feed it both shapes.
 *
 *   `noData`       the row has no `data` at all and the record has one — 004's
 *                  column empty, the whole remainder lost.
 *   `staleTier`    the ONLY difference is `data.tier`. GATED (returned into
 *                  `substance` by the caller): the fold recomputes standing for
 *                  every record at every settlement and `clearing-job.mjs` step 7
 *                  is 2.0's answer to that; a stale tier is 2.0 failing to reach
 *                  1.0's state, which is the one thing this gate exists to refuse.
 *   `replayOnly`   the only difference beyond tier is one of the keys 1.0's file
 *                  CANNOT carry (`REPLAY_ONLY_DATA_KEYS`). Reported, not gated,
 *                  and named rather than silently filtered.
 *   `otherData`    anything else — the materializer having lost part of the
 *                  record. This is the finding the two exclusions above exist to
 *                  keep legible: 92 rows of known provenance sitting in it would
 *                  bury the one row that means something.
 *
 * The order matters and is the whole shape of the function: tier first, because
 * it is the gated class and must not be swallowed by an exclusion; then the
 * replay-only keys; then, if a difference survives BOTH removals, the real one.
 */
export function dataFindings(db, registerMarks) {
  const bySlug = new Map(db.map((r) => [r.slug, r]));
  const noData = [], staleTier = [], otherData = [], missingParent = [], replayOnly = [];
  for (const m of registerMarks) {
    const r = bySlug.get(m.slug);
    if (!r) continue;
    if (r.parent == null && m.parent != null) missingParent.push(m.slug);
    if (r.data == null) { if (m.data != null) noData.push(m.slug); continue; }
    if (canonicalJson(r.data) === canonicalJson(m.data)) continue;

    const { tier: rt, ...rrest } = r.data;       // eslint-disable-line no-unused-vars
    const { tier: mt, ...mrest } = m.data ?? {}; // eslint-disable-line no-unused-vars
    if (canonicalJson(rrest) === canonicalJson(mrest)) {
      staleTier.push(`marks DIFFERS at ${m.slug} · field data.tier (the fold's standing, recomputed at close)` +
        `\n    repo says: ${mt}\n    DB says:   ${rt}`);
      continue;
    }
    // A row the replay re-identified or admitted carries keys the file cannot.
    // Strip exactly those, from BOTH sides — the checkout side never has them,
    // so a repo record that somehow did would still be compared and would still
    // differ — and ask again.
    if (canonicalJson(without(rrest, REPLAY_ONLY_DATA_KEYS)) === canonicalJson(without(mrest, REPLAY_ONLY_DATA_KEYS))) {
      // The tier may ALSO have moved on such a row; it is still the gated class
      // and is not excused by the row's provenance.
      if (canonicalJson(rt ?? null) !== canonicalJson(mt ?? null))
        staleTier.push(`marks DIFFERS at ${m.slug} · field data.tier (the fold's standing, recomputed at close)` +
          `\n    repo says: ${mt}\n    DB says:   ${rt}`);
      replayOnly.push(m.slug);
      continue;
    }
    otherData.push(m.slug);
  }
  return { noData, staleTier, otherData, missingParent, replayOnly };
}

/**
 * Every act the era's checkout holds is in `acts`, crossing by crossing.
 *
 * ab-compare's AB-P1 sweep, asked of one era. Bucketed by FLOOR, never `::int`:
 * `acts.crossing` is the FRACTIONAL crossing and a cast ROUNDS, which is how that
 * sweep first reported 27 phantom divergences.
 *
 * Journal-sourced rows only (`payload->>'_ledger' IS NULL`), for the same reason
 * AB-P1 scopes that way: `ledger-backfill.mjs` puts a second kind of legacy row
 * in the table, and counting both would report the journal as mis-bucketed by
 * exactly the number of rows the backfill correctly added.
 */
export async function actsCompleteness(client, toDir) {
  const repo = logCensus(toDir);
  const rows = await client.query(
    `SELECT floor(crossing)::int AS c, count(*)::int AS n FROM acts
      WHERE action LIKE 'legacy:%' AND (payload->>'_ledger') IS NULL GROUP BY 1`);
  const db = new Map(rows.rows.map((r) => [r.c, r.n]));
  const findings = [];
  for (const c of [...new Set([...repo.keys(), ...db.keys()])].sort((x, y) => x - y)) {
    const r = repo.get(c) ?? 0, d = db.get(c) ?? 0;
    // A crossing the checkout has PRUNED out of STATE/log (the log is a rolling
    // window — S50 no longer carries 118..150) is not a divergence: the acts are
    // in the table because an earlier checkout carried them, which is the replay
    // working. Only a crossing the checkout still states can be under-carried.
    if (!repo.has(c)) continue;
    if (r !== d) findings.push(`crossing ${c}: the checkout holds ${r} log row(s), acts holds ${d}`);
  }
  return findings;
}

/**
 * THE PROOF THAT THE GATE CAN FAIL.
 *
 * "A falsifier nobody has watched fail is not a falsifier" (world2/tools/README).
 * A gate whose only observed state is GREEN has proved nothing: three green eras
 * are three green eras only if red was reachable. So this mangles the replayed
 * register in each of the shapes a replay can actually go wrong — a value moved,
 * a mark that should stand gone, a mark standing that 1.0 never published, an act
 * missing from its crossing — and requires the parity check to notice every one.
 *
 * INSIDE A TRANSACTION, ROLLED BACK, on the same connection, exactly as
 * seed-import's `canFailProof` does and for its reason: `acts` is append-only for
 * every pen, and `marks` past the floor belongs to `clearing_job`, so a committed
 * mangle would leave the world wrong with no pen able to repair it.
 *
 * The victim is a mark this REPLAY put there (`locked_window > floor`), not a
 * seeded one. A proof that only ever mangles genesis rows proves the seed's
 * comparator, which was already proved; what is unproved here is that the gate
 * sees the eras.
 */
export async function canFailProof(client, era, worldRepo) {
  // ── THE PROOF RUNS ON A RED STORE TOO (DEC-18) ────────────────────────────
  //
  // It used to refuse: "cannot prove can-fail: parity is ALREADY red". On the
  // live store that refusal fired on the one run that mattered — cutover-eve,
  // 158 findings deep — and left the gate's own falsifier unproved exactly when
  // it was about to be relied on. A falsifier that can only be watched fail on a
  // green store is a falsifier nobody can watch fail when it counts.
  //
  // So the question changes from "was it green and did it go red" to the one that
  // was always the real one: DOES THIS MANGLE PRODUCE A FINDING THAT NAMES THE
  // ROW IT MANGLED, over and above whatever the store was already saying. That is
  // strictly stronger. The old form passes if the count merely rises; this one
  // requires the new finding to be ABOUT the victim, so a mangle that reddened
  // something unrelated — or a comparator that emits one more line under any
  // perturbation — fails the proof instead of passing it.
  //
  // The baseline is taken once, on the same connection, before any mangle.
  const clean = await parityFindings(client, era);
  const baseline = new Set(clean.substance);
  const baselineRed = clean.substance.length;

  const replayed = (await client.query(
    "SELECT slug FROM marks WHERE locked_window = $1 ORDER BY slug LIMIT 2", [era.window.id])).rows;
  if (replayed.length < 2) throw new Error(`cannot prove can-fail: window ${era.window.id} materialized fewer than two marks`);
  const [victim, gone] = replayed.map((r) => r.slug);

  const results = [];
  const mangle = async (label, sql, params = [], kind = "substance", names = null) => {
    await client.query("BEGIN");
    try {
      await client.query(sql, params);
      const p = await parityFindings(client, era);
      const a = kind === "acts" ? await actsCompletenessFor(client, worldRepo, era.to.sha) : [];
      const findings = [...p.substance, ...a];
      // What this mangle ADDED, and whether any of it names the row it broke.
      const added = findings.filter((f) => !baseline.has(f));
      const about = names ? added.filter((f) => f.includes(names)) : added;
      results.push({ mangle: label, findings, added, about, names, baselineRed });
    } finally { await client.query("ROLLBACK"); }
  };

  await mangle(`body of ${victim} (a value the era carried)`,
    "UPDATE marks SET body = body || ' — MANGLED' WHERE slug = $1", [victim], "substance", victim);
  await mangle(`geometry of ${victim} moved`,
    `UPDATE marks SET geometry = jsonb_set(geometry, '{at,x}', '99999') WHERE slug = $1`, [victim], "substance", victim);
  await mangle(`DELETE ${gone} (a mark the settlement published and the replay must have)`,
    "DELETE FROM marks WHERE slug = $1", [gone], "substance", gone);
  await mangle("INSERT forged/never-published (a mark 1.0 never had)",
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES (gen_random_uuid(), 'forged/never-published', 'sited', 'nobody', NULL, '',
             '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}'::jsonb, '((-0.5,-0.5),(0.5,0.5))'::box,
             'standing', $1, '{}'::jsonb)`, [era.window.id], "substance", "forged/never-published");
  // ── DEC-15'S OWN BREAK: UN-RETIRE ONE (2026-09-04) ─────────────────────────
  //
  // The four mangles above prove the gate sees a mark's SUBSTANCE. The
  // retirement is a fifth thing it must see and none of them touches it:
  // `standingOnly` narrows what the comparator is handed, and a narrowing is
  // exactly the shape of change that can go green for the wrong reason — a
  // filter that dropped too much would hide a real divergence and look like a
  // passing gate.
  //
  // So put the mark back on its feet. A mark 1.0's register does not carry,
  // standing in the store, must read EXTRA in DB. If it does not, the filter is
  // hiding rows rather than classifying them, and the whole ruling's parity
  // claim is unfounded.
  //
  // UN-retire rather than retire: retiring an extra mark would also be caught by
  // the MISSING half, so it could pass on the older code. This one cannot.
  const retiredRow = (await client.query(
    "SELECT slug FROM marks WHERE status = 'retired' ORDER BY slug LIMIT 1")).rows[0];
  const retirement = { checked: false };
  if (retiredRow) {
    retirement.checked = true;
    retirement.slug = retiredRow.slug;
    await mangle(`UN-RETIRE ${retiredRow.slug} (DEC-15's terminal supersession undone — the mark stands again)`,
      "UPDATE marks SET status = 'standing' WHERE slug = $1", [retiredRow.slug], "substance", retiredRow.slug);
  }

  // ── DEC-16'S OWN BREAK: PUT THE OLD SLUG BACK (2026-09-04) ─────────────────
  //
  // The retirement break above proves the gate sees a row that should be gone.
  // A transfer is the opposite shape — the row stays and its NAME moves — and no
  // mangle so far touches a name. If the era write half-applied a transfer (the
  // owner moved, the slug did not; or the whole UPDATE silently matched zero
  // rows) the store would hold a mark under a name 1.0's register no longer
  // carries, and the gate must say so twice: MISSING at the new name, EXTRA at
  // the old.
  //
  // The victim is a row that has actually been re-identified — `data ? 'formerly'`
  // is the durable mark of one — and the mangle rolls it back to the last name in
  // that list. A proof that renamed an arbitrary row would prove `compareMarks`
  // notices renames, which was never in doubt; what is unproved is that a
  // TRANSFER the replay wrote can be caught if it goes wrong.
  const moved = (await client.query(
    `SELECT slug, data->'formerly'->>-1 AS was FROM marks
      WHERE data ? 'formerly' AND jsonb_array_length(data->'formerly') > 0 ORDER BY slug LIMIT 1`)).rows[0];
  const transfer = { checked: false };
  if (moved?.was) {
    transfer.checked = true;
    transfer.slug = moved.slug;
    transfer.was = moved.was;
    await mangle(`UN-TRANSFER ${moved.slug} back to ${moved.was} (DEC-16's re-identification undone)`,
      "UPDATE marks SET slug = $2 WHERE slug = $1", [moved.slug, moved.was], "substance", moved.was);
  }

  // ── DEC-17'S OWN BREAK: UN-ADMIT ONE (2026-09-04) ──────────────────────────
  //
  // The ruling names its own falsifier: "a fixture era with a hand-planted mark
  // replays to a locked claim + standing mark, receipt unchanged; MANGLING IT TO
  // `pending` REDDENS THE GATE."
  //
  // Read literally that is two facts and only one of them is a parity finding.
  // The gate compares `marks`, so flipping the CLAIM's status alone moves nothing
  // it looks at. What "still pending" MEANS in a replay is that the mark was
  // never materialised at all — the claim sat on the docket for the clearing job
  // to adjudicate, which is exactly the pre-DEC-17 state. So the mangle is the
  // state, not the column: take the admitted mark away and require the gate to
  // say MISSING in DB.
  //
  // The victim is a row that WAS admitted (`data->>'locked_by' = 'founder'`),
  // never an arbitrary one. A proof that deleted any mark would prove
  // `compareMarks` notices a missing row, which was never in doubt and is already
  // the `DELETE gone` mangle above; what is unproved is that an admission the
  // replay wrote can be caught when it goes wrong.
  const admittedRow = (await client.query(
    `SELECT slug, id::text, data->'founder_commit'->>'sha' AS sha FROM marks
      WHERE data->>'locked_by' = 'founder' ORDER BY slug LIMIT 1`)).rows[0];
  const admission = { checked: false };
  if (admittedRow) {
    admission.checked = true;
    admission.slug = admittedRow.slug;
    admission.sha = admittedRow.sha;
    await mangle(`UN-ADMIT ${admittedRow.slug} (DEC-17's founder admission undone — the mark the hand planted at ` +
      `${String(admittedRow.sha ?? "?").slice(0, 9)} is gone, which is the register a still-pending claim would leave)`,
      "DELETE FROM marks WHERE slug = $1", [admittedRow.slug], "substance", admittedRow.slug);

    // And the ruling's literal words, asked in their own rolled-back transaction
    // because a refused statement aborts the one it is in. This pen connects as
    // `world2_owner` and 002's `claims_update_guard` exempts only `clearing_job`,
    // so the expected answer is a REFUSAL — the admission cannot be un-locked
    // from here at all, which is stronger than the ruling asked for and is worth
    // saying out loud rather than leaving as an untested assumption.
    await client.query("BEGIN");
    try {
      await client.query("UPDATE claims SET status = 'pending', decided_at = NULL WHERE id = $1", [admittedRow.id]);
      admission.pendingFlip = "PERMITTED — the guard let this pen un-lock a founder's admission";
    } catch (err) {
      admission.pendingFlip = `REFUSED by the store — ${String(err.message).split("\n")[0]}`;
    } finally { await client.query("ROLLBACK"); }
  }

  // The acts half. `acts` refuses UPDATE and DELETE from every pen (002's
  // `acts_append_only` trigger), which is the law working — so the only shape of
  // act drift the owner can provoke is an EXTRA row, and that is the one this
  // asks about. A crossing short by one is unprovokable and unproved, and saying
  // so is better than pretending otherwise.
  await mangle(`an extra act at crossing ${era.acts.crossings[0] ?? era.window.id}`,
    `INSERT INTO acts (at, crossing, actor, action, class, payload)
     VALUES (now(), $1, 'nobody', 'legacy:forged', 'legacy', '{}'::jsonb)`,
    [era.acts.crossings[0] ?? era.window.id], "acts");

  // ── THE DEDUPE'S OWN CAN-FAIL (the flip's seam, 2026-09-03) ────────────────
  //
  // The mangles above prove the PARITY gate can go red. The dedupe is a second
  // gate with its own failure mode, and it needs its own flip: `insertActs`
  // skipping nothing would look identical to a store that genuinely held
  // nothing, and the only observable difference is a duplicate row nobody sees
  // until F1 double-counts an era.
  //
  // So: take a row shape the store does NOT hold, watch the partition call it
  // fresh; INSERT it with the PEN'S SPELLING of the action (bare verb, no
  // `legacy:` prefix — the exact shape a flipped lane writes); watch the
  // partition now call it a duplicate. Both directions, because a partition
  // that answered "duplicate" to everything would pass the second half alone.
  //
  // The injected row is the pen's spelling on purpose: that is the join the
  // naive key gets wrong, and a proof that only ever injected `legacy:say`
  // would go green against a dedupe that never strips the prefix — proving the
  // opposite of what F1 needs.
  const victimAct = era.acts.rows[0];
  const dedupe = { checked: false };
  if (victimAct) {
    const probe = {
      ...victimAct,
      actor: `${victimAct.actor}-canfail`,
      at: new Date(victimAct.at).toISOString(),
    };
    const before = partitionNewActs([probe], await existingActKeys(client, [probe]));
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO acts (at, crossing, actor, action, class, payload)
         VALUES ($1, $2, $3, $4, 'legacy', '{}'::jsonb)`,
        [probe.at, probe.crossing, probe.actor, String(probe.action).replace(/^legacy:/, "")]);
      const during = partitionNewActs([probe], await existingActKeys(client, [probe]));
      dedupe.checked = true;
      dedupe.freshBefore = before.fresh.length === 1;
      dedupe.skippedDuring = during.skipped.length === 1;
      dedupe.ok = dedupe.freshBefore && dedupe.skippedDuring;
      dedupe.probe = `${probe.actor} ${probe.action} @ ${probe.at}`;
    } finally { await client.query("ROLLBACK"); }
  }

  const after = await parityFindings(client, era);
  // SILENT = the mangle produced no NEW finding naming the row it broke. On a
  // green store this is exactly the old `!r.findings.length`; on a red one it is
  // the only reading that means anything.
  const silent = results.filter((r) => !r.about.length);
  // And the rollback is judged against the BASELINE, not against zero — a store
  // that was red before the proof must read exactly as red after it, no more and
  // no less, or a mangle escaped its transaction.
  const restoredSet = new Set(after.substance);
  const restored = restoredSet.size === baseline.size && [...baseline].every((f) => restoredSet.has(f));
  return { results, restored, baselineRed, silent, dedupe, retirement, transfer, admission };
}

// ── the store's state, and the refusal ───────────────────────────────────────

export async function storeState(client) {
  const windows = (await client.query(
    "SELECT id, opens_at, closes_at, status, law_sha, town_sha FROM windows ORDER BY id")).rows;
  const marks = (await client.query("SELECT count(*)::int c FROM marks")).rows[0].c;
  const acts = (await client.query("SELECT count(*)::int c FROM acts")).rows[0].c;
  const claims = (await client.query(
    "SELECT window_id, status, count(*)::int c FROM claims GROUP BY 1,2 ORDER BY 1,2")).rows;
  return { windows, marks, acts, claims };
}

const REFLOOR = `
TO RE-FLOOR THE STORE (world2/tools/README.md § The seed — the sanctioned reset):

  psql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'   # world2_owner, dev only
  for f in 001_tables 002_grants 003_falsifier_roles 004_marks_data 005_candle_tiling; do
    psql -f world2/schema/$f.sql
  done
  git clone --depth 1 --branch sandbox/seed https://github.com/postmark-town/postmark-world.git /tmp/frozen
  node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed \\
    --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf --with-acts
  # then re-run the two projections at the frozen shas (law-ingest, stamp-ingest)

Every row is derived from a frozen tag and the ids are deterministic, so a rebuilt
floor is identical to the one that was there — row for row.`;

/**
 * Refuse a second replay over a store that has already moved, and say what a
 * continuation would mean.
 *
 * seed-import's idiom, and its reason: `acts` is append-only for EVERY pen, so a
 * partial replay cannot be undone, only continued or rebuilt. `--continue` is the
 * sanctioned second run — an era whose window is already CLOSED is not re-ingested
 * but VERIFIED against its own tag and then skipped, so a continuation can only
 * ever run on top of a replay that is still exactly what this tool wrote.
 */
export function assertReplayable(state, { eras, cont }) {
  const closed = new Set(state.windows.filter((w) => w.status === "closed").map((w) => w.id));
  const wanted = eras.map((e) => e.window.id);
  const already = wanted.filter((id) => closed.has(id));
  if (already.length && !cont) {
    throw new Error(
      `refusing to replay: window(s) ${already.join(", ")} are already closed in this store — ` +
      `the replay has run before, or the town moved past the floor.\n\n` +
      `IF THAT WAS THIS TOOL, pass --continue: each already-closed window is VERIFIED against its ` +
      `own settlement tag and then skipped, and only the eras that are genuinely missing are ingested.\n` +
      REFLOOR);
  }
  return new Set(already);
}

// ── the pens this tool does not hold ─────────────────────────────────────────

const runPen = (script, args, env, label) => {
  try {
    return execFileSync(process.execPath, [join(HERE, script), ...args],
      { encoding: "utf8", env: { ...process.env, ...env } }).trim();
  } catch (e) {
    throw new Error(`${label} failed:\n${String(e.stdout ?? "")}${String(e.stderr ?? e.message)}`);
  }
};

/** law_ingester's pen, at the era's sha. Shelled, never borrowed. */
export function ingestLaw(dir, sha) {
  const url = process.env.WORLD2_INGEST_URL;
  if (!url) throw new Error("WORLD2_INGEST_URL is not set — the law ingest is law_ingester's pen and needs its own credential");
  const u = new URL(url);
  return runPen("law-ingest.mjs", ["--law-repo", dir, "--sha", sha], {
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGDATABASE: u.pathname.slice(1),
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
  }, `law-ingest at ${sha.slice(0, 8)}`);
}

/**
 * clearing_job's pen, on the era's window. THE PRODUCTION PEN, UNMODIFIED.
 *
 * A refusal here is not an error to be handled — it is the gate's finding, and it
 * is returned rather than thrown so the report can quote it verbatim beside the
 * era it happened in. "Canon that 2.0's constraints refuse is exactly what this
 * gate exists to surface."
 */
export function runClearing(windowId, { townRepo } = {}) {
  if (!process.env.WORLD2_CLEARING_URL)
    throw new Error("WORLD2_CLEARING_URL is not set — the clearing is clearing_job's pen and needs its own credential");
  const args = ["--window", String(windowId), ...(townRepo ? ["--town-repo", townRepo] : [])];
  try {
    return { ok: true, out: execFileSync(process.execPath, [join(HERE, "clearing-job.mjs"), ...args],
      { encoding: "utf8" }).trim() };
  } catch (e) {
    return { ok: false, out: `${String(e.stdout ?? "")}${String(e.stderr ?? e.message)}`.trim() };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

const USAGE =
  "usage: replay-ingest.mjs --world-repo <full clone> --from-tag <ref> --to-tag <ref>\n" +
  "                        [--town-repo <checkout>] [--town-sha <sha>]\n" +
  "                        [--continue] [--can-fail-proof] [--dry-run] [--json]";

async function main() {
  if (flag("--help")) { console.log(USAGE + "\n" + REFLOOR); process.exit(0); }
  const worldRepo = argOf("--world-repo");
  const fromTag = argOf("--from-tag");
  const toTag = argOf("--to-tag");
  if (!worldRepo || !fromTag || !toTag) { console.error(USAGE); process.exit(2); }
  const townSha = argOf("--town-sha");
  const townRepo = argOf("--town-repo");
  const cont = flag("--continue");
  const dry = flag("--dry-run");

  const headBefore = git(worldRepo, "rev-parse", "HEAD");
  const bounds = erasBetween(worldRepo, fromTag, toTag);
  console.log(`replay ${fromTag} → ${toTag} · ${bounds.length} era(s), one per WINDOW the town's clock closed (F-5): ` +
    `${bounds.map((e) => e.to.tag).join(", ")}`);

  // Derive every era first, from the checkouts, before a single row is written.
  // The derivation is pure (seed-import's own contract), and doing it up front is
  // what lets --dry-run ask exactly the questions the real run will ask.
  const eras = [];
  // Every re-identification the range has seen, derived id → the id the row keeps.
  // Owned here because only this loop sees the eras in order, and a transfer's
  // consequences outlive its own era (ruled 2026-09-04; see `eraClaims`).
  const reidentified = new Map();
  for (const b of bounds) {
    const from = checkoutAt(worldRepo, b.from.sha, "from");
    const to = checkoutAt(worldRepo, b.to.sha, "to");
    try {
      const window = eraWindow({ toDir: to.dir, lawSha: b.to.sha, townSha });
      window.closes_at = commitDate2(worldRepo, b.to.sha);

      // THE RULED WINDOW WINS, and the disagreement is reported rather than
      // hidden. `eraWindow` reads the highest INTEGER log, which lags a missed
      // save; the era's number comes from the commit that first named the window
      // in either form. They agree on every window the town saved on time, and
      // where they do not, the reason IS the finding.
      let ruledWindow = null;
      if (b.window != null && b.window !== window.id) {
        ruledWindow = { was: window.id, is: b.window };
        window.id = b.window;
      }
      const acts = eraActs({ fromDir: from.dir, toDir: to.dir });
      // The acts go IN as well as out: DEC-15 case (a) is decided by whether this
      // era's own log already carries the `withdraw`, and the shas are what case
      // (b) attributes the removal to.
      const claims = await eraClaims({
        fromDir: from.dir, toDir: to.dir, window, acts,
        worldRepo, fromSha: b.from.sha, toSha: b.to.sha, reidentified,
      });
      // The settlement's own receipt, held against what we derived from its outcome.
      // The boundary already read its own subject in `erasBetween` — asking git a
      // second time is a second reading of the same fact, and the two could drift.
      const subject = b.to.subject ?? git(worldRepo, "log", "-1", "--format=%s", b.to.sha);
      const receipt = eraReceipt({ publishes: b.publishes ?? [], derived: claims.claims.length });

      // THE TOWN SAID THE NUMBER; the log rule derived it. Two independent
      // readings of one fact, so they are compared rather than one being trusted.
      if (ruledWindow) {
        const opener = git(worldRepo, "log", "-1", "--format=%h (%s)", b.opensAt ?? b.to.sha);
        receipt.clockDisagrees =
          `window ${ruledWindow.is} is named first by ${opener.slice(0, 74)} — the highest INTEGER log there still ` +
          `reads ${ruledWindow.was}, because the save that would have written \`${ruledWindow.is}.jsonl\` never ran`;
      } else if (b.statedWindow != null && b.statedWindow !== window.id) {
        receipt.clockDisagrees =
          `the town's own commit says \`crossing-save ${b.statedWindow}\` and the log rule reads window ${window.id}`;
      }
      if (b.foldedWith) {
        receipt.folded = `windows ${b.foldedWith.join(" and ")} were named by ONE commit — the save that wrote this ` +
          `window's log wrote its neighbour's too, so no tree stands between them`;
      }

      // THE HAND IS ALREADY FOUND (DEC-17). It used to be asked here, and only
      // when a receipt disagreed, because it was a diagnosis of a number.
      // `eraClaims` now asks it of every era because the answer decides how the
      // claim is written, so this reads what the derivation already knows rather
      // than walking git a second time and risking a second answer.
      receipt.hand = claims.hand;
      receipt.handAmends = claims.handAmends;
      eras.push({ ...b, window, acts, ...claims, subject, receipt });
      // The register at S(k) is the parity oracle and is kept; the checkouts are not.
    } finally { to.dispose(); from.dispose(); }
  }

  for (const e of eras) {
    console.log(`\n── ERA ${e.to.tag} (window ${e.window.id}) ─────────────────────────`);
    console.log(`   world ${e.to.sha.slice(0, 8)} · closes ${e.window.closes_at}`);
    console.log(`   acts   ${String(e.acts.rows.length).padStart(4)}  ${JSON.stringify(e.acts.byType)} · crossings ${e.acts.crossings.join(", ") || "—"}`);
    const locked = e.claims.filter((c) => c.data?.locked_by === "founder").length;
    console.log(`   claims ${String(e.claims.length).padStart(4)}  ${e.added.length} added · ${e.amended.length} amended` +
      (locked ? ` · ${e.claims.length - locked} pending, ${locked} LOCKED by the founder's hand (DEC-17)` : ""));
    if (e.amended.length) console.log(`          amended: ${e.amended.map((x) => x.mark.slug).join(", ")}`);
    if (e.transferred.length) {
      console.log(`   transferred ${String(e.transferred.length).padStart(1)}  (DEC-16 — the record changed hands; the same row keeps its id)`);
      for (const t of e.transferred) {
        console.log(`          ${t.from_slug} → ${t.to_slug} · ${t.commit.sha.slice(0, 9)} (${t.commit.at})` +
          `${t.moved ? ` · the FILE MOVED (${t.moved.score}, M-8) ${t.moved.from} → ${t.moved.to}` : ""}` +
          `${t.amended ? " · ALSO edited this era → one amend claim under the new slug" : " · nothing else changed, so no claim"}`);
        if (t.children?.length) {
          console.log(`          ${t.children.join(", ")} name this mark as their PARENT: derived ` +
            `${uuid5(t.to_slug).slice(0, 8)} from the new name, resolved to ${uuid5(t.from_slug).slice(0, 8)}, ` +
            `the id the row kept`);
        }
      }
    }
    if (e.retired.length) {
      const ruled = e.retired.filter((r) => !isUnruled(r));
      console.log(`   retired ${String(ruled.length).padStart(4)}  (DEC-15 — a standing mark that left the register)` +
        (e.unruled.length ? ` · ${e.unruled.length} UNRULED` : ""));
      for (const r of e.retired) {
        console.log(`          ${r.slug} — ${r.case === "a"
          ? `(a) withdrawn in the log · ${r.act.actor} @ ${r.act.at}`
          : r.case === "b"
            ? `(b) the founder's hand · ${r.commit.sha.slice(0, 9)} (${r.commit.at}) — one \`withdraw\` by the-town synthesised`
            : `⚠ UNRULED — ${r.why}: ${r.detail}`}`);
      }
    }
    if (e.receipt.hand?.length) {
      const by = [...new Set(e.receipt.hand.map((h) => h.sha.slice(0, 9)))];
      console.log(`   ${e.receipt.hand.length} planted by hand → locked  (DEC-17 — an ADMISSION, by ` +
        `${by.length} non-sweep commit(s); no door saw them and no sweep counted them. The claim is LOCKED at this ` +
        `window by the founder's hand and the mark stands; the clearing job never re-judges canon.)`);
      for (const h of e.receipt.hand.slice(0, 3)) console.log(`          ${h.slug} — ${h.sha.slice(0, 9)} ${h.subject.slice(0, 68)}`);
      if (e.receipt.hand.length > 3) console.log(`          … and ${e.receipt.hand.length - 3} more`);
    }
    if (e.receipt.handAmends?.length) {
      const by = [...new Set(e.receipt.handAmends.map((h) => h.sha.slice(0, 9)))];
      console.log(`   ${e.receipt.handAmends.length} amended by hand → locked  (DEC-17 — the same hand, its second ` +
        `face, by ${by.length} non-sweep commit(s); the locked claim SUPERSEDES the standing mark.)`);
      for (const h of e.receipt.handAmends.slice(0, 2)) console.log(`          ${h.slug} — ${h.sha.slice(0, 9)} ${h.subject.slice(0, 64)}`);
      if (e.receipt.handAmends.length > 2) console.log(`          … and ${e.receipt.handAmends.length - 2} more`);
    }
    // THE RULING'S OWN CLAIM, ASKED RATHER THAN ASSERTED: "the clearing job never
    // re-judges canon." The job selects `status = 'pending'` and nothing else
    // (`clearing-job.mjs` :89), so what it would re-judge of the founder's hand is
    // exactly the pending claims whose slug the hand touched. Expected zero, and
    // it is PRINTED rather than assumed — a number that can only be zero if the
    // admission actually reached the claim.
    const handSlugs = new Set([...(e.receipt.hand ?? []), ...(e.receipt.handAmends ?? [])].map((h) => h.slug));
    if (handSlugs.size) {
      const left = e.claims.filter((c) => handSlugs.has(c.slug) && c.status !== "locked").map((c) => c.slug);
      console.log(`          of the ${handSlugs.size} slug(s) the hand touched, ${left.length} would reach the ` +
        `clearing job as a resident's pending claim` + (left.length ? `: ${left.slice(0, 4).join(", ")}` : " (none)"));
    }
    if (e.receipt.checked && !e.receipt.ok) {
      const acc = (e.receipt.hand?.length ?? 0) + (e.receipt.handAmends?.length ?? 0);
      const gap = e.claims.length - e.receipt.six.published;
      console.log(`   = ${e.receipt.six.published} published + ${e.receipt.hand?.length ?? 0} added by hand + ` +
        `${e.receipt.handAmends?.length ?? 0} amended by hand ${acc === gap ? "= EXACTLY the derived count" :
          `leaves ${gap - acc} claim(s) this pen cannot yet account for`}`);
    }
    if (e.receipt.clockDisagrees) console.log(`   ⚠ ${e.receipt.clockDisagrees}`);
    console.log(`   receipt ${e.receipt.noSweep ? `NO SWEEP — ${e.receipt.why}`
      : e.receipt.checked
        ? (e.receipt.ok
          ? `AGREES — this window's ${e.receipt.sweeps} sweep(s) published ${e.receipt.six.published} between them`
          : `DISAGREES — ${e.receipt.why}`)
        : `UNCHECKABLE — ${e.receipt.why}`}`);
    if (e.receipt.sweeps > 1) {
      console.log(`          the window's sweeps, each with its own count: ` +
        e.publishes.map((p) => `${p.sha.slice(0, 8)}×${sixCountOf(p.subject)?.published ?? "?"}`).join(" + "));
    }
    const w = doorWitness(e);
    if (w.total) {
      console.log(`   door    ${w.matched.length}/${w.total} leave-mark act(s) name a mark this era's claim set carries` +
        (w.unmatched.length ? ` · unmatched (left drafted, or a slug the act spells differently): ${w.unmatched.map((u) => u.slug ?? "(no object)").join(", ")}` : ""));
    }
    if (e.acts.vanished.length) console.log(`   ⚠ ${e.acts.vanished.length} log row(s) present at ${e.from.tag} and ABSENT at ${e.to.tag} — the log is append-only by law`);
  }

  if (dry) {
    if (flag("--json")) {
      console.log(JSON.stringify(eras.map((e) => ({
        tag: e.to.tag, sha: e.to.sha, window: e.window.id, closes_at: e.window.closes_at,
        acts: e.acts.rows.length, acts_by_type: e.acts.byType,
        claims: e.claims.length, added: e.added.map((m) => m.slug), amended: e.amended.map((x) => x.mark.slug),
        retired: e.retired.map((r) => ({
          slug: r.slug, case: r.case, why: r.why, path: r.path,
          retired_by: r.commit?.sha ?? null, subject: r.commit?.subject ?? null,
          synthesises_act: Boolean(r.synthesised), becomes: r.becomes ?? null, detail: r.detail ?? null,
        })),
        transferred: e.transferred.map((t) => ({
          from_slug: t.from_slug, to_slug: t.to_slug, path: t.path,
          commit: t.commit.sha, subject: t.commit.subject, also_amended: Boolean(t.amended),
        })),
      })), null, 2));
    }
    // A dry run whose eras cannot be written must not read like one that can.
    const clock = windowFindings(eras);
    if (clock.length) {
      console.log(`\nTHE TOWN'S CLOCK · ${clock.length} finding(s) — an era is one WINDOW, so the windows must ` +
        `count without gaps:`);
      for (const f of clock) console.log(`  ${f.kind.toUpperCase().padEnd(9)} ${f.text}`);
    }
    const blocked = eras.filter((e) => e.unruled.length);
    if (clock.length) {
      console.log(`\nREFUSED · the era sequence does not walk the town's clock one window at a time, so it cannot ` +
        `be written. The store's own guard would refuse at the first of these ("${eras[0]?.to.tag} is window N and ` +
        `the store's open window is M"); this names all ${clock.length} before a connection is opened.`);
      assertHeadUnmoved(worldRepo, headBefore);
      process.exit(1);
    }
    if (blocked.length) {
      console.log(`\nREFUSED · ${blocked.reduce((n, e) => n + e.unruled.length, 0)} departure(s) in ` +
        `${blocked.length} era(s) are NOT the transition DEC-15 ruled on, and no era carrying one can be written:`);
      for (const e of blocked) {
        for (const r of e.unruled) console.log(`  ${e.to.tag}  ${r.slug} — ${r.why}: ${r.detail}`);
      }
      console.log(`\nEach one wants a ruling of its own. Nothing was written; nothing could have been.`);
      assertHeadUnmoved(worldRepo, headBefore);
      process.exit(1);
    }
    // The rule's own receipt, printed rather than asserted: every claim whose
    // parent was re-identified, and the two numbers. Zero of these on a range with
    // no transfer is the honest answer; a number here is the foreign key that did
    // not fire.
    const resolved = eras.flatMap((e) => e.parentResolved.map((p) => ({ ...p, tag: e.to.tag })));
    if (resolved.length) {
      console.log(`\nPARENT RESOLVED THROUGH THE STANDING ROW · ${resolved.length} claim(s) — a reference follows ` +
        `the row, not the name (ruled 2026-09-04, DEC-16's \`supersedes\` law one column down):`);
      for (const p of resolved) {
        console.log(`  ${p.tag}  ${p.slug} · parent ${p.derived.slice(0, 8)} (derived from the new name) ` +
          `→ ${p.standing.slice(0, 8)} (the id the row kept)`);
      }
    }
    console.log("\ndry-run · nothing written, no connection opened");
    assertHeadUnmoved(worldRepo, headBefore);
    process.exit(0);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();                 // PGHOST/PGDATABASE/PGUSER/PGPASSWORD (world2_owner)
  await client.connect();

  const report = [];
  try {
    const state0 = await storeState(client);

    if (flag("--can-fail-proof")) {
      const closed = state0.windows.filter((w) => w.status === "closed").map((w) => w.id);
      const at = Math.max(...closed);
      const era = eras.find((e) => e.window.id === at);
      if (!era) throw new Error(`--can-fail-proof needs the store to be AT one of this range's tags; its tip is window ${at}`);
      const proof = await canFailProof(client, era, worldRepo);
      for (const r of proof.results) {
        console.log(`${r.about.length ? "CAUGHT " : "SILENT "} mangle: ${r.mangle} — ` +
          `${r.added.length} finding(s) beyond the baseline of ${r.baselineRed}` +
          `${r.names ? `, ${r.about.length} of them naming ${r.names}` : ""}`);
        for (const f of r.about.slice(0, 2)) console.log(`  ${f.split("\n").join("\n  ")}`);
      }
      if (proof.baselineRed) {
        console.log(`\n(the store was ALREADY red at this tag: ${proof.baselineRed} finding(s). The proof is ` +
          `therefore "did each mangle add a finding that NAMES the row it broke", which is stronger than the ` +
          `green-store form — see canFailProof's header.)`);
      }
      console.log(proof.restored ? "RESTORED after rollback — the store reads exactly as it did before the proof"
        : "NOT RESTORED after rollback — THE PROOF DID NOT CLEAN UP");
      if (!proof.retirement.checked) {
        console.log("SKIPPED the retirement break — this store holds no retired mark to un-retire " +
          "(no era replayed so far removed a standing mark; DEC-15's filter is UNPROVED here)");
      }
      if (!proof.transfer.checked) {
        console.log("SKIPPED the transfer break — this store holds no re-identified mark (no `data.formerly`) " +
          "to hand back its old name; DEC-16's write is UNPROVED here");
      }
      if (!proof.admission.checked) {
        console.log("SKIPPED the admission break — this store holds no mark the founder's hand admitted " +
          "(no `data.locked_by = founder`); DEC-17's write is UNPROVED here");
      } else {
        console.log(`       the admission break took ${proof.admission.slug} ` +
          `(planted at ${String(proof.admission.sha ?? "?").slice(0, 9)}); ` +
          `un-locking its claim from this pen: ${proof.admission.pendingFlip}`);
      }
      if (!proof.dedupe.checked) {
        console.log("SKIPPED the dedupe proof — this era derived no acts to inject a duplicate of");
      } else {
        console.log(`${proof.dedupe.ok ? "GREEN" : "RED  "} dedupe: ${proof.dedupe.probe} read FRESH before the ` +
          `duplicate was injected (${proof.dedupe.freshBefore}) and SKIPPED after it, with the pen's spelling of the ` +
          `action rather than the derived one (${proof.dedupe.skippedDuring})`);
      }
      const ok = proof.silent.length === 0 && proof.restored && (!proof.dedupe.checked || proof.dedupe.ok);
      console.log(ok ? `\ncan-fail PROVEN at ${era.to.tag}: every mangle produced a finding naming the row it ` +
          `broke, and rollback restored the store's prior reading.`
        : `\ncan-fail NOT PROVEN: ${proof.silent.length} mangle(s) the gate did not notice.`);
      await client.end();
      assertHeadUnmoved(worldRepo, headBefore);
      process.exit(ok ? 0 : 1);
    }

    // F-5: the eras must walk the clock one window at a time before a single row
    // is written. The per-era guard below would catch it too, but only after the
    // eras before it had COMMITTED — and `acts` is append-only, so a run that
    // discovers this halfway through leaves a half-replayed world with no repair
    // path. Asked once, up front, for the same reason `assertReplayable` is.
    const clock = windowFindings(eras);
    if (clock.length) {
      throw new Error(
        `the era sequence does not walk the town's clock one window at a time — ${clock.length} finding(s), and a ` +
        `replay clears exactly one candle at a time:\n` + clock.map((f) => `  ${f.kind.toUpperCase()}  ${f.text}`).join("\n"));
    }

    const skip = assertReplayable(state0, { eras, cont });
    // The last window the store actually closed — the only already-replayed era
    // whose parity is still a question the register can answer.
    const tip = Math.max(...state0.windows.filter((w) => w.status === "closed").map((w) => w.id), -Infinity);

    for (const e of eras) {
      const head = `${e.to.tag} · window ${e.window.id}`;
      console.log(`\n══ ${head} ══════════════════════════════════════════`);

      if (skip.has(e.window.id)) {
        // ONLY THE STORE'S TIP CAN BE RE-CHECKED. A parity check asks "does the
        // register say what 1.0's says at S(k)", and once S(k+1) has been replayed
        // the register has moved on by design — every mark the later settlement
        // published would read as EXTRA. Reporting that as a divergence would
        // manufacture 14 findings out of the replay working, which is the shape of
        // false alarm ab-compare paid for twice. An earlier era's parity was
        // checked when it ran; it is not re-checkable now, and the report says
        // that rather than reporting a pass.
        if (e.window.id !== tip) {
          console.log(`already replayed — the store has moved on to window ${tip}, so this tag's parity ` +
            `cannot be re-checked (it was checked when the era ran)`);
          report.push({ tag: e.to.tag, window: e.window.id, skipped: true, recheckable: false,
            substance: [], provenance: [], acts: [], clearing: null });
          continue;
        }
        const parity = await parityFindings(client, e);
        const actsF = await actsCompletenessFor(client, worldRepo, e.to.sha);
        console.log(`already replayed — VERIFIED at the store's tip, not re-ingested`);

        // DEC-18 — EVERY FINDING SAYS WHY. A 158-line wall with no causes is read
        // once. The classification is best-effort and never invents a pass: if it
        // throws, the findings print exactly as before and all of them still red.
        const causes = await classifyParity(parity.substance, { worldRepo, sha: e.to.sha, client });
        report.push({ tag: e.to.tag, window: e.window.id, skipped: true, recheckable: true,
          substance: parity.substance, provenance: parity.provenance, acts: actsF, clearing: null,
          causes });
        for (const f of parity.substance) console.log(`  ✗ ${f.split("\n").join("\n    ")}`);
        for (const p of parity.provenance) console.log(`  ⚑ ${p}`);
        if (causes) console.log(renderCauses(causes));
        continue;
      }

      // DEC-15 rules ONE transition, and an era carrying a departure of any other
      // shape is not replayable by it. This is the old `eraClaims` throw, moved to
      // where it costs nothing to have seen the whole range first.
      if (e.unruled.length) {
        throw new Error(
          `${e.to.tag}: ${e.unruled.length} mark(s) left the register in a way DEC-15 does not rule on, so this ` +
          `era cannot be replayed:\n` +
          e.unruled.map((r) => `  ${r.slug} — ${r.why}: ${r.detail}`).join("\n") +
          `\n\nDEC-15 rules a standing mark whose RECORD LEFT CANON. Writing these as retirements would put a ` +
          `\`withdraw\` in the log for a mark nobody withdrew. Run --dry-run for the whole range's list, and take ` +
          `it to a ruling.`);
      }


      // The window this era clears must be the one the store has open — asked
      // FRESH each era, because the previous era's clearing opened its successor.
      const live = (await client.query("SELECT id, opens_at, status FROM windows WHERE status = 'open'")).rows;
      if (live.length !== 1) {
        throw new Error(`the store has ${live.length} open window(s); a replay clears exactly one at a time ` +
          `(gold §1: the candle never leaves the town without an open window, and never with two)`);
      }
      if (live[0].id !== e.window.id) {
        throw new Error(
          `${e.to.tag} is window ${e.window.id} by its own STATE/log, and the store's open window is ${live[0].id}. ` +
          `The replay is pointed at a store that is not where its checkout says it is; it refuses rather than ` +
          `clearing the wrong candle.`);
      }

      // (a) + (b), one transaction: the era's acts and its docket, or neither.
      // Since DEC-15 the retirements ride in it too — the log line and the flipped
      // status are one event and must not be separable by a crash.
      let acted = { inserted: 0, skipped: 0, byAction: {} };
      const synthesised = [...e.retired, ...e.transferred].map((r) => r.synthesised).filter(Boolean);
      const claimsMoved = [];
      // DEC-17: the claims the founder's own commit decided. Read off the claim
      // rather than re-derived from `e.hand`, because the claim is what the store
      // receives and a second derivation could disagree with the first.
      const founderLocked = e.claims.filter((c) => c.data?.locked_by === "founder");
      let admitted = 0;
      await client.query("BEGIN");
      try {
        // The window closed when the settlement landed. `opens_at` is not touched:
        // 005_candle_tiling's trigger owns it, and it is already the predecessor's close.
        await client.query("UPDATE windows SET closes_at = $2 WHERE id = $1", [e.window.id, e.window.closes_at]);
        // The synthesised withdraws go through the SAME `insertActs` — not a
        // second INSERT beside it — so the dedupe judges them like any row and a
        // re-run of an era cannot write a founder's retirement twice.
        acted = await insertActs(client, [...e.acts.rows, ...synthesised]);
        await insertClaims(client, e.claims);

        // ── THE RE-IDENTIFICATION (DEC-16), BEFORE THE RETIREMENTS ────────────
        //
        // The same row, renamed. Not a delete and an insert — the id stays, so
        // `marks.parent`, `claims.supersedes` and every other by-id reference
        // follow without being touched, which is the entire point of the ruling.
        //
        // Four things move together, and each is a fact of the settlement's own
        // outcome rather than a choice of ours:
        //   slug       the register's new name for this record
        //   owner      `by:`, the thing that actually changed in the file
        //   household  the FOLD's answer for the new owner. `household` is in
        //              SUBSTANCE_COLUMNS, so leaving it behind would turn the
        //              parity gate red on a lawful transfer — and nothing else
        //              would move it: `clearing-job.mjs` step 7 recomputes `tier`
        //              inside the window transaction and only `tier`.
        //   formerly   the old slug, APPENDED — a mark may change hands twice, and
        //              a scalar would lose the first owner silently (012's CHECK
        //              is the schema half of the same sentence).
        //
        // `data.tier` is deliberately NOT written here: it is the fold's standing,
        // the clearing job recomputes it for every standing mark at the close, and
        // writing it twice is how it went stale in the first place.
        for (const t of e.transferred) {
          const cur = (await client.query(
            "SELECT id::text, status, owner FROM marks WHERE slug = $1", [t.from_slug])).rows[0];
          if (!cur) {
            throw new Error(`${e.to.tag}: 1.0's register carried ${t.from_slug} at ${e.from.tag} and this era hands it ` +
              `to ${t.to_slug}, but the store holds no such mark — the store is not where its checkout says it is.`);
          }
          if (cur.status !== "standing") {
            throw new Error(`${e.to.tag}: ${t.from_slug} is '${cur.status}' in the store and DEC-16 re-identifies a ` +
              `STANDING mark. The store disagrees with the register about this row; that is a finding, and this era ` +
              `refuses rather than writing over it.`);
          }
          const taken = (await client.query("SELECT id::text FROM marks WHERE slug = $1", [t.to_slug])).rows[0];
          if (taken) {
            throw new Error(`${e.to.tag}: ${t.from_slug} is handed to ${t.to_slug}, and the store already holds a mark ` +
              `at that slug (${taken.id}). One name would mean two records; this era refuses rather than choosing ` +
              `which one it means.`);
          }
          await client.query(
            `UPDATE marks
                SET slug = $2, owner = $3, household = $4,
                    data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
                             'formerly', COALESCE(data->'formerly', '[]'::jsonb) || to_jsonb($1::text)),
                    geometry = CASE WHEN geometry ? 'slug'
                                    THEN jsonb_set(geometry, '{slug}', to_jsonb($2::text))
                                    ELSE geometry END
              WHERE slug = $1 AND status = 'standing'`,
            [t.from_slug, t.to_slug, t.now.owner, t.now.household]);

          // A PENDING claim naming the old slug names this row, and the row has
          // moved. History does not move: a LOCKED claim was submitted under the
          // name the mark had then, and rewriting it would forge the record of
          // what a resident actually filed. Expected to be zero in a replay — the
          // era's own amend claim is derived under the NEW slug — so a nonzero
          // count is reported rather than absorbed, and it carries a question this
          // pen does not answer: a claim filed by the OLD owner on a mark that now
          // belongs to someone else is an ownership matter, not a rename.
          const moved = await client.query(
            "UPDATE claims SET slug = $2 WHERE slug = $1 AND status = 'pending'", [t.from_slug, t.to_slug]);
          if (moved.rowCount) claimsMoved.push({ ...t, n: moved.rowCount });
        }

        // THE RETIREMENT, last, and refusing rather than skipping. A row the
        // register says left must be STANDING here: anything else means the store
        // and the register disagree about what the world was before this era, and
        // that is a finding, not a no-op. `UPDATE … WHERE status = 'standing'`
        // alone would report the disagreement as zero rows changed, which is the
        // silence this whole tool is against — so the row is read first and the
        // refusal says which of the two shapes it is.
        for (const r of e.retired) {
          const cur = (await client.query("SELECT status FROM marks WHERE slug = $1", [r.slug])).rows[0];
          if (!cur) {
            throw new Error(`${e.to.tag}: 1.0's register carried ${r.slug} at ${e.from.tag} and this era retires it, ` +
              `but the store holds no such mark at all — the store is not where its checkout says it is.`);
          }
          if (cur.status !== "standing") {
            throw new Error(`${e.to.tag}: ${r.slug} is '${cur.status}' in the store and DEC-15 retires a STANDING mark. ` +
              `The store disagrees with the register about this row; that is a finding, and this era refuses ` +
              `rather than writing over it.`);
          }
          // `retired_window`, NOT `locked_window` — 001 gives `marks` a column for
          // exactly this and `snapshot-export.mjs` already emits it. The first cut
          // of DEC-15 wrote the window into `locked_window`, which would have
          // ERASED the window the mark was locked in: the one column the parity
          // report calls different "BY CONSTRUCTION (a replayed mark locks in the
          // window that actually cleared it, which is the point)". A retirement
          // that overwrote it would have made that sentence false and left nothing
          // able to notice. The two windows are two different facts about a mark
          // and the schema has always had two columns for them.
          await client.query(
            "UPDATE marks SET status = 'retired', retired_window = $2 WHERE slug = $1 AND status = 'standing'",
            [r.slug, e.window.id]);
        }

        // ── THE ADMISSION (DEC-17), LAST ──────────────────────────────────────
        //
        // "A founder's hand on main is an ADMISSION in every face … the clearing
        // job never re-judges canon." The claims went in already `locked` above;
        // this is the other half — the mark standing, materialised HERE, in the
        // era's own transaction, so a founder's record and the log line that
        // explains it are one event.
        //
        // LAST, after the transfers and the retirements, and the order is the
        // reason: `marks.slug` is UNIQUE, a transfer frees a name and a
        // retirement flips a status, and a mark planted into a name this same era
        // released must meet the register as it finally stands rather than as it
        // stood mid-transaction.
        //
        // `materializeClaims` IS THE CLEARING JOB'S OWN, imported. Two things
        // follow for free and neither is ours to re-decide: `marks.household`
        // resolves from the CLAIMANT through `identities` (the 08-28 ownership-
        // grain ruling — copying `claims.household` put GitHub logins on 26 rows),
        // and an amend REWRITES the standing row in place keeping its id rather
        // than inserting a second one. `recomputeStanding` is deliberately NOT
        // called: the clearing job runs it for every standing mark at (d), which
        // is after this, and writing tier twice is how it went stale before.
        if (founderLocked.length) {
          const amends = new Map();
          for (const c of founderLocked) {
            if (!c.supersedes) continue;
            const { rows: [standing] } = await client.query(
              "SELECT id::text, locked_window FROM marks WHERE slug = $1 AND status = 'standing'", [c.slug]);
            if (!standing) {
              throw new Error(`${e.to.tag}: the founder's hand amended ${c.slug} at ${c.data.founder_commit.sha.slice(0, 9)} ` +
                `and DEC-17 supersedes the STANDING mark, but the store holds no standing row at that slug — the store ` +
                `is not where its checkout says it is.`);
            }
            if (String(standing.id) !== String(c.supersedes)) {
              throw new Error(`${e.to.tag}: ${c.slug} supersedes claim ${String(c.supersedes).slice(0, 8)} and the ` +
                `standing mark's id is ${standing.id.slice(0, 8)}. A mark's id IS its first locking claim's id, so ` +
                `these must be the same number; this era refuses rather than amending a row it cannot name.`);
            }
            amends.set(String(c.id), standing);
          }
          admitted = await materializeClaims(client.query.bind(client),
            { claims: founderLocked, amends, windowId: e.window.id, label: `${e.to.tag} · the founder's hand` });
        }
        await client.query("COMMIT");
      } catch (err) { await client.query("ROLLBACK"); throw err; }
      for (const t of e.transferred) {
        console.log(`  re-identified ${t.from_slug} → ${t.to_slug} at window ${e.window.id} — DEC-16, the same row ` +
          `keeps its id; ${t.commit.sha.slice(0, 9)}; one \`transfer\` by the-town synthesised` +
          (t.amended ? `; the record was ALSO edited this era, so an amend claim rides under the new slug` : ""));
      }
      for (const c of claimsMoved) {
        console.log(`  ⚑ ${c.n} PENDING claim(s) named ${c.from_slug} and now name ${c.to_slug}. Expected zero in a ` +
          `replay. Whether a claim filed under the old owner survives the transfer is an ownership question, not a rename.`);
      }
      for (const r of e.retired) {
        console.log(`  retired ${r.slug} at window ${e.window.id} — ${r.case === "a"
          ? `(a) the era's own \`withdraw\` act is the retirement`
          : `(b) the founder's hand, ${r.commit.sha.slice(0, 9)}; one \`withdraw\` by the-town synthesised into the log`}`);
      }
      for (const c of founderLocked) {
        console.log(`  admitted ${c.slug} at window ${e.window.id} — DEC-17, the founder's hand, ` +
          `${c.data.founder_commit.sha.slice(0, 9)}; the claim is LOCKED and the mark stands` +
          (c.supersedes ? `, superseding ${String(c.supersedes).slice(0, 8)}` : ""));
      }
      if (founderLocked.length && admitted !== founderLocked.length) {
        console.log(`  ⚑ ${founderLocked.length} founder-locked claim(s) went in and ${admitted} materialised — ` +
          `a claim naming no mark does not materialise (a stake or an escrow), and none of these should be one.`);
      }
      console.log(`  ingested: ${acted.inserted} act(s), ${e.claims.length - founderLocked.length} claim(s) pending` +
        (founderLocked.length ? `, ${founderLocked.length} LOCKED by the founder's hand (DEC-17)` : "") +
        (acted.skipped
          ? `\n  skipped ${acted.skipped} act(s) the store already holds — the pen wrote them on a flipped lane and ` +
            `the drain photographed them into STATE/log, so this era derives them a second time: ` +
            `${Object.entries(acted.byAction).map(([k, n]) => `${k}×${n}`).join(", ")}`
          : ""));

      // (c) the law at this era's sha, by its own pen.
      const dir = checkoutAt(worldRepo, e.to.sha, "law");
      try { console.log("  " + ingestLaw(dir.dir, e.to.sha).split("\n").join("\n  ")); }
      finally { dir.dispose(); }

      // (d) the production clearing job. Its refusals are the gate's findings.
      const cleared = runClearing(e.window.id, { townRepo });
      console.log(`  ${cleared.ok ? "" : "CLEARING REFUSED — "}${cleared.out.split("\n").join("\n  ")}`);

      const refusals = (await client.query(
        `SELECT c.status, c.refusal_check, c.geometry->>'slug' AS slug
           FROM claims c WHERE c.window_id = $1 AND c.status <> 'locked' ORDER BY 3`, [e.window.id])).rows;
      for (const r of refusals) console.log(`  ⚑ ${r.slug}: ${r.status} — ${r.refusal_check ?? "(no check named)"}`);

      const parity = await parityFindings(client, e);
      const actsF = await actsCompletenessFor(client, worldRepo, e.to.sha);

      console.log(`\n  PARITY ${parity.substance.length === 0 && actsF.length === 0 ? "GREEN" : "RED"} at ${e.to.tag}`);
      for (const f of parity.substance) console.log(`    ✗ ${f.split("\n").join("\n      ")}`);
      for (const f of actsF) console.log(`    ✗ acts ${f}`);
      for (const p of parity.provenance) console.log(`    ⚑ ${p}`);

      report.push({
        tag: e.to.tag, window: e.window.id, skipped: false,
        acts_ingested: e.acts.rows.length, claims_ingested: e.claims.length,
        added: e.added.map((m) => m.slug), amended: e.amended.map((x) => x.mark.slug),
        retired: e.retired.map((r) => ({ slug: r.slug, case: r.case, retired_by: r.commit?.sha ?? null })),
        transferred: e.transferred.map((t) => ({ from_slug: t.from_slug, to_slug: t.to_slug, commit: t.commit.sha })),
        clearing: cleared.out, clearing_ok: cleared.ok,
        refusals: refusals.map((r) => ({ slug: r.slug, status: r.status, check: r.refusal_check })),
        substance: parity.substance, provenance: parity.provenance, acts: actsF,
      });
    }
  } finally {
    await client.end();
    assertHeadUnmoved(worldRepo, headBefore);
  }

  const red = report.filter((r) => r.substance.length || r.acts.length);
  console.log(`\n══ VERDICT ═══════════════════════════════════════════════`);
  for (const r of report) {
    const v = r.skipped && r.recheckable === false ? "  — "
      : r.substance.length || r.acts.length ? "RED " : "GREEN";
    console.log(`  ${v}  ${r.tag} (window ${r.window})` +
      (r.skipped
        ? (r.recheckable === false ? "  [replayed earlier; the store has moved past this tag]" : "  [verified at the tip, not re-ingested]")
        : `  ${r.acts_ingested} acts, ${r.claims_ingested} claims`) +
      (r.refusals?.length ? `  · ${r.refusals.length} claim(s) not locked` : ""));
    for (const f of r.substance) console.log(`         ✗ ${f.split("\n")[0]}`);
    for (const f of r.acts) console.log(`         ✗ acts ${f}`);
    for (const p of r.provenance) console.log(`         ⚑ ${p}`);
  }
  if (flag("--json")) console.log(JSON.stringify(report, null, 2));
  process.exit(red.length ? 1 : 0);
}

/** The completeness check wants the era's checkout; make one, ask, throw it away. */
async function actsCompletenessFor(client, worldRepo, sha) {
  const c = checkoutAt(worldRepo, sha, "acts");
  try { return await actsCompleteness(client, c.dir); }
  finally { c.dispose(); }
}

/**
 * The caller's checkout is exactly where they left it.
 *
 * Stated as a check rather than as a promise, because "this pen never moves your
 * checkout" is the kind of claim that stays true right up until a `finally` block
 * is edited. It costs one `rev-parse`.
 */
function assertHeadUnmoved(repo, before) {
  const after = git(repo, "rev-parse", "HEAD");
  if (after !== before) {
    throw new Error(`this pen moved ${resolve(repo)} from ${before} to ${after} — it must not; the era ` +
      `checkouts are throwaway worktrees and the caller's HEAD is theirs`);
  }
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(2); });
}
