// settlement-escalate.mjs — a TERMINAL refusal reaches a person, not a log line.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// Two of the settlement's exits are terminal — nothing the box can do clears
// them, and the next crossing composes the same result:
//
//   · a `canon-bad` refusal (deploy/settlement-classify.mjs): the path that
//     fails the gate is in origin/main's own tree, so every crossing from now
//     on refuses identically, twice a day, until somebody edits the record;
//   · a race that survived all three attempts of the retry wrapper: a door
//     write is landing on every single pass, which is contention and not a
//     transient.
//
// ── AND A THIRD, WHICH WAS TERMINAL ALL ALONG AND WAITED ANYWAY (#2793) ─────
//
// A RED GRAMMAR SUITE. It meets this file's own definition of terminal word for
// word — nothing the box can do clears it, and the next crossing composes the
// same red — and until 2026-09-14 it escalated only through `recurring-refusal`,
// i.e. on the THIRD unsettled crossing in a row, which is a day and a half.
//
// Measured: 2026-09-14 05:45Z, the S70 crossing refused "grammar suite red and
// the isolation pass could not attribute it to a mark this crossing carried — a
// finding for the keeper, not a retry". That run's journal carries the refusal
// and nothing else: no `[settlement-escalate]` line, no issue, no ping. The
// operator round found it at 12:35Z. Seven hours, and the fix was waiting on a
// person who had not been told.
//
// So `suite-red` files on the FIRST occurrence, and it carries the two things a
// person needs before they can act: the suite's own `not ok` lines, and what the
// isolation pass did. The recurring threshold is untouched for every other
// refusal shape — three-in-a-row is still what makes an individually-rerunnable
// refusal terminal, and this class was never that.
//
// Both used to end as a red unit and a journal line at, in the real case,
// 02:39:26Z. `systemctl --failed` carries it; the roll-call carries it the next
// time somebody runs the operator round; nothing carries it TO anyone. The box
// already pushes to GitHub with the office pen, so the operator queue is one
// API call away and there is no reason a terminal finding should wait for a
// human to come looking.
//
// ── UPDATE, NEVER DUPLICATE ─────────────────────────────────────────────────
//
// A canon-bad refusal repeats every twelve hours by definition. An escalation
// that filed a fresh issue each crossing would bury the queue in a week and
// teach its reader to close them unread — which is a louder version of the
// silence this replaces. So: an OPEN issue whose title matches exactly gets a
// comment; only the absence of one files anything.
//
// The match is done over a LISTING of open issues, deliberately, and not over
// the search API: search is an index with lag measured in minutes, and two
// crossings inside that lag would each conclude no issue existed and file one.
// A listing is the repository's own answer about its own state.
//
// ── THE CREDENTIAL ──────────────────────────────────────────────────────────
//
// The office's git credential store, /srv/postmark-office/.git-credentials —
// the same one settlement-auto.sh hands the sweep clone. Measured on the box
// 2026-08-31: it holds `https://postmark-pen:<token>@github.com`, the token
// carries scope `public_repo`, and against the town repo it answers 200 on the
// issue listing with `push: true` and `has_issues: true`. No new secret, no new
// path, nothing this script has to be told.
//
// The repo is POSTMARK_TOWN_REPO (`postmark-town/postmark` on the box), NOT the
// `keeminlee/postmark` name — that one 301-redirects, and the GitHub API does
// not follow a redirect for a POST.
//
// ── WHEN THERE IS NO CREDENTIAL ─────────────────────────────────────────────
//
// It says ISSUE-WANTED, loudly, with the whole body it would have filed, and
// exits 0. A crossing is never failed by its own escalation: the refusal is
// already the finding, and a transport that could turn a refusal into a crash
// would be a second, worse outage on top of the first.
//
// Usage:
//   node deploy/settlement-escalate.mjs --class canon-bad --receipt /srv/postmark-harbor/settlement-auto.json
//   node deploy/settlement-escalate.mjs --class suite-red --receipt <path> \
//        --suite-log <path> --isolate unattributable|not-run
//   … --dry-run     compose and print the exact request, send nothing
// Exit: always 0.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_REPO = "postmark-town/postmark";
export const DEFAULT_CRED = "/srv/postmark-office/.git-credentials";

/** The issue title. Stable per class — it IS the update key. */
export function titleFor(klass) {
  // a warning is not a refusal, and its standing issue must not be found under
  // a refusal's name: the town published, and the title says so
  return klass === "suite-warning" ? `settlement warning: ${klass}` : `settlement refusal: ${klass}`;
}

/** The token out of a git credential store, or null. Never logged, never returned in a body. */
export function tokenFrom(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^https:\/\/[^:/]+:([^@]+)@github\.com/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * IS THIS RECEIPT ACTUALLY A SUITE-RED REFUSAL. The gate on the new class, and
 * it exists because `--class` is an argument: a caller that passed the word over
 * the wrong receipt — a stale `settlement-auto.json` from the last crossing that
 * PUBLISHED, a half-written one, a hand-typed rerun of the escalator — would
 * file an issue about a red that is not there, and a queue that cries wolf is
 * the silence this file replaces wearing a louder coat.
 *
 * TWO CONDITIONS, AND THE SECOND IS A DELIBERATE COUPLING. The status must be
 * `refused`, and the receipt's own words must name the grammar suite. Those
 * words are written at exactly two places in `settlement-auto.sh` — the
 * UNATTRIBUTABLE exit and the isolate-off exit — and the falsifier quotes both
 * verbatim, so rewording a refusal reddens this rather than quietly turning the
 * escalation off.
 */
export const SUITE_RED_CAUSE = /grammar suite red/i;

export function isSuiteRedRefusal(receipt) {
  if (receipt?.status !== "refused") return false;
  return SUITE_RED_CAUSE.test(`${receipt?.detail ?? ""}\n${receipt?.refusal?.cause ?? ""}`);
}

/**
 * THE TWO CLASSES OF 2026-09-16, gated the same way. A harm refusal is a refused
 * receipt whose harm report tripped, or whose detail says the gate could not
 * run (the two words `settlement-auto.sh` writes at that exit). A suite warning
 * is a PUBLISHED receipt whose checker went red — a warning over a crossing that
 * landed, and the receipt must say both or nothing is filed.
 */
export const HARM_CAUSE = /HARM NAMED|harm gate could not gate/i;
export function isHarmRefusal(receipt) {
  if (receipt?.status !== "refused") return false;
  if (receipt?.harm && receipt.harm.ok === false) return true;
  return HARM_CAUSE.test(`${receipt?.detail ?? ""}\n${receipt?.refusal?.cause ?? ""}`);
}
export function isSuiteWarning(receipt) {
  return receipt?.status === "published" && receipt?.suite?.red === true;
}

/**
 * The suite's own reds, out of its log. NOT a summary and not a tail: the `not
 * ok` lines are the only part of a 40,000-line runner log that says which law or
 * which record broke, and they are what the journal already shouts at the same
 * two exits (`grep -E "^not ok"`).
 *
 * CAPPED, and the cap SAYS SO. A suite that goes red in the fixtures can produce
 * hundreds; an issue body has a size limit and a reader has a smaller one. What
 * must never happen is a silent truncation — a count that stops at forty reads
 * as forty reds, and the denominator is the thing an operator is judging.
 */
export function notOkLines(text, { max = 40 } = {}) {
  const all = String(text ?? "").split(/\r?\n/).filter((l) => /^not ok\b/.test(l));
  if (all.length <= max) return all;
  return [...all.slice(0, max),
    `… and ${all.length - max} more \`not ok\` line(s) — ${all.length} in total. The whole log is `
    + "`settlement-last-suite.log` in the office tree on the box."];
}

/**
 * WHAT THE ISOLATION PASS DID, in words, from a word the CALLER passes.
 *
 * It is not inferred here, and that is the point. The two exits reach this file
 * from different states — the isolator ran and could attribute nothing, or it
 * was switched off and never ran — and the receipt is `isolated: null` for both,
 * because a pass that attributed nothing writes no isolate report. The shell is
 * the only thing that knows which happened, so the shell says, and a word this
 * map does not carry is reported as NOT SAID rather than guessed. An instrument
 * that names the wrong subject is worse than one that says it does not know.
 */
const ISOLATE_VERDICT = {
  unattributable:
    "IT RAN AND ATTRIBUTED NOTHING. The isolator bisected the marks this crossing carried and could not find a "
    + "subset whose removal turns the suite green, so the red is not any one mark's — it is the law's, the "
    + "record's, or the machinery's. Nothing is quarantined and the whole town is held.",
  "not-run":
    "IT DID NOT RUN — this crossing was started with `SETTLEMENT_ISOLATE=0`, so nothing tried to attribute the "
    + "red to a mark. If the red might belong to one mark rather than to the law, rerun with the isolator on "
    + "before repairing anything: it is the cheaper answer and it lets the rest of the town settle.",
};

export function isolateVerdict(word) {
  return ISOLATE_VERDICT[word]
    ?? "NOT SAID. This escalation was filed without naming what the isolation pass did, which is a gap in the "
       + "caller rather than a verdict — read the unit's journal for the isolator's own narration.";
}

/**
 * The issue body: the whole refusal, quoted, plus the sentence that says what
 * to do with it. The receipt goes in verbatim — a summary of a refusal is how
 * an operator ends up debugging the summary.
 */
export function bodyFor(klass, receipt, { at = new Date().toISOString(), suiteLog = null, isolate = null } = {}) {
  // TWO CLASSES SPEAK OVER THE RECEIPT'S OWN next_step, because for those two
  // the per-crossing advice has stopped being true and repeating it is what
  // wasted the three days this exists to end.
  const OVERRIDE = {
    race:
      "a door write is landing on every pass. This is contention, not a transient: nothing needs repairing, "
      + "but the crossing publishes nothing until the writes quiet down. The next scheduled crossing tries "
      + "again on its own.",
    "recurring-refusal":
      "THE RERUN HAS STOPPED BEING THE ANSWER. Three crossings in a row have ended without completing. Each "
      + "refusal may be individually rerunnable and none of them has cleared, which means whatever produces "
      + "them is upstream of the rerun — the shape of postmark-world 7f866059, where the same 2-error lint "
      + "refusal returned every crossing from 08-28 to 08-30 and was cleared only by a hand repairing the "
      + "drawer. Read the last crossing's own next_step below for what it named, then look for what keeps "
      + "re-proposing it rather than repairing the instance again.",
    "suite-red":
      "THE FIRST OCCURRENCE IS THE ESCALATION (#2793), and that is what changed on 2026-09-14. A red grammar "
      + "suite is terminal by this file's own definition — nothing the box can do clears it, the next crossing "
      + "composes the same red, and the town publishes NOTHING until a person edits either the law or the "
      + "record. Read the `not ok` lines below, decide which of the two they name, and repair it. Then finish "
      + "the crossing by hand rather than waiting for the clock: `sudo systemctl start "
      + "postmark-settlement-by-hand.service` (#2786) takes the newest window that is still unfolded. Until "
      + "this class existed a suite red reached a person only through `recurring-refusal`, on the THIRD "
      + "unsettled crossing — a day and a half — and the 05:45Z S70 refusal sat unread for seven hours.",
    harm:
      "THE CROSSING REFUSED FOR HARM (founder-ruled 2026-09-16: a failed settlement is a crisis). The harm gate "
      + "compared the tree the sweep produced with the tree it started from and found a resident's mark moved or "
      + "lost with no act naming it, the sweep's word not matching the tree, a fold that ran stampless, or two "
      + "parcels on one ground — the checks and the marks are named below. Nothing published. Repair by a world "
      + "pull request (the sweep or the record, whichever the rows name); the next crossing carries the town. If "
      + "the gate COULD NOT RUN (no report, no fold, no tool at this world sha), that is the finding, and the "
      + "repair is the crossing's own chain.",
    "suite-warning":
      "THE TOWN IS PUBLISHED. The grammar suite ran after the push and went red — a WARNING, not a refusal "
      + "(founder-ruled 2026-09-16: the suite holds no crossing; harm does). Every resident's mark stands where "
      + "the harm gate proved it stands. Read the `not ok` lines below and repair the test or the record by a "
      + "world pull request, whose CI runs the same suite; no crossing waits on it.",
  };
  const nextStep = OVERRIDE[klass] ?? receipt?.next_step ?? "read the refusal below and decide the removal lane.";

  const lines = [
    klass === "suite-warning"
      ? `**${klass}** — the settlement PUBLISHED at \`${receipt?.at ?? at}\` and its grammar suite went red afterwards.`
      : `**${klass}** — the settlement refused at \`${receipt?.at ?? at}\` and cannot clear itself.`,
    "",
    "### What to do",
    "",
    nextStep,
    "",
  ];

  // THE HARM GATE'S OWN ROWS, above the receipt: the checks that tripped and the
  // marks each one named, which is the whole of what a person acts on.
  if (klass === "harm") {
    const tripped = (receipt?.harm?.checks ?? []).filter((c) => c && c.ok !== true);
    lines.push("### The harm gate's own rows", "");
    if (tripped.length) {
      for (const c of tripped) {
        lines.push(`**${c.name}** — ${c.count ?? (c.rows ?? []).length} row(s)${c.note ? ` (${c.note})` : ""}`, "", "```",
          ...((c.rows ?? []).length ? c.rows : ["(no rows carried)"]), "```", "");
      }
    } else if (receipt?.harm == null) {
      lines.push("The gate did not produce a report: it could not run. The receipt's `detail` says why (no report, "
        + "no fold, or no `tools/harm-gate.mjs` at this world sha). That is the finding.", "");
    } else {
      lines.push("The receipt carries a harm report with no tripped check — the caller escalated `harm` over a "
        + "gate that found none. Read the receipt's `detail`.", "");
    }
  }
  if (klass === "suite-warning") {
    const reds = notOkLines(suiteLog);
    lines.push("### The suite's own reds, after the push", "");
    if (reds.length) lines.push("```", ...reds, "```");
    else if (suiteLog == null)
      lines.push("The suite log could not be read at escalation time. It is `settlement-last-suite.log` in the "
        + "office tree on the box — the crossing copies it there.");
    else
      lines.push("The suite log carries NO `not ok` line. The runner failed without naming a test — a crash, an "
        + "out-of-memory, a runner that never started. Read the log's tail.");
    lines.push("");
  }

  // THE TWO THINGS A PERSON NEEDS BEFORE THEY CAN ACT ON A SUITE RED, and they
  // are above the receipt rather than inside it: the receipt says the suite was
  // red, and every question after that ("red at what?", "is it one mark's?") is
  // answered by these and by nothing else on the page.
  if (klass === "suite-red") {
    const reds = notOkLines(suiteLog);
    lines.push("### The suite's own reds", "");
    if (reds.length) lines.push("```", ...reds, "```");
    else if (suiteLog == null)
      lines.push("The suite log could not be read at escalation time. It is `settlement-last-suite.log` in the "
        + "office tree on the box — the crossing copies it there before it exits.");
    else
      lines.push("The suite log carries NO `not ok` line. The gate failed without naming a test, and that is "
        + "itself the finding: a crash, an out-of-memory, a runner that never started. Read the log's tail.");
    lines.push("", "### The isolation pass", "", isolateVerdict(isolate), "");
  }

  lines.push(
    "### The refusal, verbatim",
    "",
    "```json",
    JSON.stringify(receipt ?? { note: "no receipt was readable at escalation time" }, null, 1),
    "```",
    "",
    "---",
    "",
    "Filed by `deploy/settlement-escalate.mjs` on the box. This issue is UPDATED, never duplicated:",
    "every further crossing that refuses with this class comments here. Close it when the record is",
    "repaired — the next crossing files a fresh one if the fault returns.",
  );
  return lines.join("\n");
}

async function api(path, { token, method = "GET", body = null, repo }) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "postmark-settlement-escalate",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the status is the answer */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** The open issue with exactly this title, or null. Listing, never search. */
export async function findOpen(title, { token, repo }) {
  for (let page = 1; page <= 5; page++) {
    const r = await api(`/issues?state=open&per_page=100&page=${page}`, { token, repo });
    if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) return null;
    // Pull requests come back on this endpoint too and are never our issue.
    const hit = r.json.find((i) => !i.pull_request && i.title === title);
    if (hit) return hit;
    if (r.json.length < 100) return null;
  }
  return null;
}

export async function escalate({
  klass, receipt, token, repo, dryRun = false, log = console.error, suiteLog = null, isolate = null,
}) {
  const title = titleFor(klass);

  // THE GATE COMES BEFORE THE BODY, not after it. A wrong-receipt escalation
  // that composed its body first would print the whole invented issue into the
  // journal on the no-credential path, which is the same false alarm reaching a
  // person by the other road.
  if (klass === "suite-red" && !isSuiteRedRefusal(receipt)) {
    log("[settlement-escalate] NOT FILED — `--class suite-red` was asked over a receipt that is not a suite-red "
      + `refusal (status ${JSON.stringify(receipt?.status ?? null)}). Nothing was filed: an issue about a red `
      + "that is not there teaches the queue to be ignored, which is the silence this file exists to end.");
    return { filed: false, reason: "not-a-suite-red-refusal", title };
  }
  // The same gate for the two classes born 2026-09-16, for the same reason.
  if (klass === "harm" && !isHarmRefusal(receipt)) {
    log("[settlement-escalate] NOT FILED — `--class harm` was asked over a receipt that is not a harm refusal "
      + `(status ${JSON.stringify(receipt?.status ?? null)}). Nothing was filed.`);
    return { filed: false, reason: "not-a-harm-refusal", title };
  }
  if (klass === "suite-warning" && !isSuiteWarning(receipt)) {
    log("[settlement-escalate] NOT FILED — `--class suite-warning` was asked over a receipt that is not a published "
      + `crossing with a red suite (status ${JSON.stringify(receipt?.status ?? null)}, suite.red `
      + `${JSON.stringify(receipt?.suite?.red ?? null)}). Nothing was filed.`);
    return { filed: false, reason: "not-a-suite-warning", title };
  }

  const body = bodyFor(klass, receipt, { suiteLog, isolate });

  if (!token) {
    log(`[settlement-escalate] ISSUE-WANTED — no usable GitHub credential, so this terminal refusal reaches nobody.`);
    log(`[settlement-escalate] ISSUE-WANTED title: ${title}`);
    log(`[settlement-escalate] ISSUE-WANTED body follows:\n${body}`);
    return { filed: false, reason: "no-credential", title };
  }
  // A dry run still does the LOOKUP. It is the read half, it is the half that
  // proves the credential reaches the repo, and a dry run that skipped it could
  // not tell you the one thing you want to know — whether this would file a new
  // issue or land on the one already standing.
  const open = await findOpen(title, { token, repo });

  if (dryRun) {
    log(`[settlement-escalate] DRY RUN on ${repo} — title: ${title}`);
    log(open
      ? `[settlement-escalate] DRY RUN — would COMMENT on the standing ${repo}#${open.number}`
      : `[settlement-escalate] DRY RUN — no open issue with that title; would FILE a new one`);
    log(body);
    return { filed: false, reason: "dry-run", title, body, repo, standing: open ? open.number : null };
  }
  if (open) {
    const r = await api(`/issues/${open.number}/comments`, { token, repo, method: "POST", body: { body } });
    if (r.ok) {
      log(`[settlement-escalate] commented on the standing issue ${repo}#${open.number} — ${title}`);
      return { filed: true, updated: true, number: open.number, url: open.html_url };
    }
    log(`[settlement-escalate] ISSUE-WANTED — could not comment on ${repo}#${open.number} (HTTP ${r.status}); the refusal is in this journal only`);
    return { filed: false, reason: `comment-${r.status}`, title };
  }

  const r = await api(`/issues`, { token, repo, method: "POST", body: { title, body } });
  if (r.ok && r.json?.number) {
    log(`[settlement-escalate] filed ${repo}#${r.json.number} — ${title}`);
    return { filed: true, updated: false, number: r.json.number, url: r.json.html_url };
  }
  log(`[settlement-escalate] ISSUE-WANTED — could not file on ${repo} (HTTP ${r.status}); the refusal is in this journal only`);
  log(`[settlement-escalate] ISSUE-WANTED body follows:\n${body}`);
  return { filed: false, reason: `create-${r.status}`, title };
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export async function run() {
  const klass = argOf("class", "unclassified");
  const repo = argOf("repo", process.env.POSTMARK_TOWN_REPO || DEFAULT_REPO);
  // `SETTLEMENT_ESCALATE_CRED` exists so the WIRING can be falsified without a
  // network. `test/settlement-suite-red-escalates.test.mjs` runs the real
  // settlement-auto.sh to its suite-red exit and reads the escalator's own
  // ISSUE-WANTED line as the proof that the call site fired — and that line only
  // appears when no credential is found. Without this override the test would
  // pass on a laptop and POST TO GITHUB on the box, where
  // `/srv/postmark-office/.git-credentials` is exactly where it is expected to
  // be. A probe whose answer depends on where it is run is not a probe.
  //
  // `--credentials` still wins, and an unset env is the default it has always
  // been, so nothing about the box's own path changes.
  const credPath = argOf("credentials", process.env.SETTLEMENT_ESCALATE_CRED || DEFAULT_CRED);
  const receiptPath = argOf("receipt");

  const suiteLogPath = argOf("suite-log");
  const isolate = argOf("isolate");

  let receipt = null;
  try { receipt = receiptPath ? JSON.parse(readFileSync(receiptPath, "utf8")) : null; } catch { receipt = null; }

  // `null` and `""` are different facts and the body says them differently: a
  // log that could not be read is a missing instrument, a log that read empty is
  // a suite that named no test. Only an unreadable path becomes null.
  let suiteLog = null;
  try { suiteLog = suiteLogPath ? readFileSync(suiteLogPath, "utf8") : null; } catch { suiteLog = null; }

  let token = null;
  try { token = existsSync(credPath) ? tokenFrom(readFileSync(credPath, "utf8")) : null; } catch { token = null; }

  try {
    await escalate({
      klass, receipt, token, repo, suiteLog, isolate, dryRun: process.argv.includes("--dry-run"),
    });
  } catch (err) {
    // Network down, DNS gone, GitHub throwing 502s. The refusal still happened
    // and the crossing still exited on it; this line is the whole cost.
    console.error(`[settlement-escalate] ISSUE-WANTED — the transport itself failed (${err.message}); the refusal is in this journal only`);
  }
  return 0;
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
if (isMain) run().then((c) => process.exit(c));
