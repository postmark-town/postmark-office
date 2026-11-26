// dev-follow-lib.mjs — what decides the dev office's carries (POS-1256): the open train, the
// DEPLOY.md dev-box-steps check, the dev-preview label's one-holder rule, and the receipt.
// Pure functions over plain data, so test/dev-follow.test.mjs can drive every branch
// without a runner or a box. Workflow machinery for .github/workflows/dev-follow.yml, not an
// office tool (the same split as suite-lib.mjs and suite-shard.mjs).
//
// THE LAW THIS IS BUILT FROM (Darko, 2026-11-26, POS-1256): "yes please set up 1 2 and 3
// now and put the new join flow on it". The issue's three pieces that touch the office:
//   2. the dev office follows the open train: a push to the open `train/<week>` carries that
//      head to dev, unless the push changes that train's deploy/DEPLOY.md dev box steps,
//      which still wait for a hand;
//   3. a `dev-preview` label on an office PR carries that PR's head to dev, one holder at a
//      time; removing the label (or closing the PR) returns dev to the open train.
// SHIPPING.md § 3, the dev office bullet: "First, read that train's deploy/DEPLOY.md for dev
// box steps ... If they wait, the carry waits too: code carried without its box steps fails
// dev's units."
//
// THE SHAPE: every run decides from the truth it can read (the trains on origin, dev's own
// release.json, the holder PR's state), never from the event alone. A GitHub concurrency
// group keeps one running and one pending run and drops the rest, so an event can be dropped;
// a decision that needs every event would drift, and one that reads the truth heals.
//
// DEV'S BASELINE. "Did the dev box steps change" is asked against what dev was last given
// box steps for, not against the push's parent. Otherwise a push that changed the steps (and
// carried nothing) would be followed by an innocent push that carries the first one's code
// without its steps. The baseline is dev's carried commit (release.json's sha), or, while a
// PR holds dev, the commit dev ran before the preview (holder.prior.sha).

export const LABEL = "dev-preview";
export const DEV_ROOT = "/srv/postmark-office-dev";
export const DEV_SERVICE = "postmark-office-dev";
export const DEV_PORT = 4381;

// ── the open train ──────────────────────────────────────────────────────────
// The open train is the newest train/<year>-w<week>[suffix]: the next train opens from the frozen
// tip the night of the freeze (SHIPPING § 2.1), so the frozen release's train is always an
// older one. A branch that is not named like a train is not one (train/anything-else).
const TRAIN = /^train\/(\d{4})-w(\d{1,2})([a-z]?)$/;

export function parseTrain(name) {
  const m = TRAIN.exec(String(name ?? ""));
  return m ? { year: Number(m[1]), week: Number(m[2]), suffix: m[3] } : null;
}

const trainOrder = (a, b) => a.year - b.year || a.week - b.week || (a.suffix < b.suffix ? -1 : a.suffix > b.suffix ? 1 : 0);

/** The newest train among branch names, or null when none is named like one. */
export function newestTrain(names) {
  let best = null;
  let bestName = null;
  for (const name of names ?? []) {
    const t = parseTrain(name);
    if (t && (!best || trainOrder(t, best) > 0)) { best = t; bestName = name; }
  }
  return bestName;
}

export const isOpenTrain = (branch, names) => newestTrain(names) === branch;

// ── DEPLOY.md: did the dev box steps change ─────────────────────────────────
// A dev-box-steps section is one whose heading names dev as a word ("The dev office's own pins",
// "The dev rehearsal", "The dev seed advance"), or whose body says a release "reaches dev"
// (§ The dev office's own pins: "when the release carrying this reaches dev"; § Static keys:
// "before the train that carries this reaches dev"). A heading is a heading only outside a code
// fence: the file's shell blocks carry `# comment` lines. `world2_dev` is not the word dev, and
// a body that only mentions dev (`--omit=dev`, "the DEV office runs the train") is not a section
// of box steps. Wording that is only whitespace or line ends changes nothing.
const collapse = (s) => String(s).replace(/\s+/g, " ").trim();

export function sectionsOf(md) {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let cur = { heading: "", lines: [] };
  let fence = null;
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const h = fence === null && !f ? /^#{1,6}\s+(.*\S)\s*$/.exec(line) : null;
    if (h) { sections.push(cur); cur = { heading: h[1], lines: [] }; } else cur.lines.push(line);
  }
  sections.push(cur);
  return sections.map((s) => ({ heading: s.heading, body: collapse(s.lines.join("\n")) }));
}

export function isDevStepsSection(s) {
  return s.heading !== "" && (/\bdev\b/i.test(s.heading) || /\breach(?:es)? dev\b/i.test(s.body));
}

function devSectionMap(md) {
  const map = new Map();
  const seen = new Map();
  for (const s of sectionsOf(md)) {
    if (!isDevStepsSection(s)) continue;
    const n = (seen.get(s.heading) ?? 0) + 1;
    seen.set(s.heading, n);
    map.set(n === 1 ? s.heading : `${s.heading} (#${n})`, `${s.heading}\n${s.body}`);
  }
  return map;
}

/**
 * Whether the dev box steps differ between two copies of deploy/DEPLOY.md (null for a copy that
 * does not exist). A dev section added, removed or reworded counts, in either copy.
 * @returns {{changed: boolean, sections: string[]}}
 */
export function devBoxStepsChanged(beforeMd, afterMd) {
  const a = devSectionMap(beforeMd);
  const b = devSectionMap(afterMd);
  const sections = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) if (a.get(k) !== b.get(k)) sections.push(k);
  return { changed: sections.length > 0, sections };
}

// ── shas and the receipt ────────────────────────────────────────────────────
const HEX = /^[0-9a-f]+$/;
/** Two shas name one commit: equal, or the shorter (7+ hex) is a prefix of the other. */
export function sameSha(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !HEX.test(a) || !HEX.test(b)) return false;
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
}
export const short = (sha) => String(sha ?? "").slice(0, 7);

/**
 * The release.json the carry writes beside the code (release-train.yml writes tag, sha,
 * deployed_at, target, run; src/release.mjs reads those five). A PR holding dev adds `holder`,
 * which the door ignores: it is for the next run, and for a person reading the box.
 */
export function buildReceipt({ tag, sha, runUrl, holder = null, now }) {
  const receipt = { tag, sha, deployed_at: now, target: "dev", run: runUrl };
  if (holder) receipt.holder = holder;
  return receipt;
}

// ── the decision ────────────────────────────────────────────────────────────
const WRITERS = new Set(["write", "maintain", "admin"]);

function holderLooksLive(holder, holderPr, repo) {
  return Boolean(
    holder && holderPr && holderPr.number === holder.pr && holderPr.state === "open" &&
    holderPr.headRepo === repo && holderPr.labels.includes(LABEL),
  );
}

/**
 * What one run does. Every input is data:
 *   event      { kind: "push", branch } or { kind: "pr", action, labelName, sender, pr: { number, state, headSha, headRepo, labels } }
 *   repo       "owner/name", the office repo
 *   trains     the train/* branch names on origin; trainHeads maps each to its head sha
 *   box        { readable, tag, sha, holder } read from dev's release.json
 *   holderPr   the PR box.holder names, as GitHub has it now ({ number, state, headRepo, labels, headSha }), or null
 *   labelerPermission  the sender's permission on the repo, for a `labeled` event
 *   stepsChanged(baselineSha, targetSha) -> { changed, sections, error? }
 *   now        an ISO instant
 * @returns {{status: "carry"|"noop"|"wait"|"refuse", reason: string, target: object|null, holder: object|null, notices: object[], unlabel: number[]}}
 */
export function decide(ctx) {
  const { event, repo, trains, trainHeads, box, holderPr, labelerPermission, stepsChanged, now } = ctx;
  const holder = box.readable ? box.holder ?? null : null;
  const live = holderLooksLive(holder, holderPr, repo);
  const open = newestTrain(trains);
  const baseline = holder ? holder.prior?.sha ?? null : box.readable ? box.sha ?? null : null;
  const res = (status, reason, extra = {}) => ({ status, reason, target: null, holder: null, notices: [], unlabel: [], ...extra });

  const steps = (target) => {
    if (!baseline) return { changed: true, sections: [], error: "dev has no carried commit to compare the box steps against" };
    return stepsChanged(baseline, target);
  };
  const waitsForAHand = (s, target, introducedBy) => {
    const where = s.error ? s.error : `sections: ${s.sections.join("; ")}`;
    return `dev waits for a hand: DEPLOY.md dev box steps changed in ${short(introducedBy)} (${where}).`;
  };
  const backToTrain = (reasonPrefix, prNotice) => {
    // Dev returns to the open train's head, with the same box-steps check against what dev last had steps for.
    if (!open) return res("noop", `${reasonPrefix}: there is no open train to return to`);
    const target = trainHeads[open];
    const s = steps(target);
    if (s.changed) {
      const msg = `${waitsForAHand(s, target, target)} Dev still runs the previous preview's code, with no holder; it needs a hand carry of ${open}.`;
      return res("wait", `${reasonPrefix}: ${msg}`, { notices: prNotice ? [{ when: "now", to: "pr", number: prNotice, body: msg }] : [] });
    }
    return res("carry", `${reasonPrefix}: dev returns to ${open} at ${short(target)}`, {
      target: { tag: open, sha: target, ref: open }, holder: null,
      notices: prNotice ? [{ when: "after-carry", to: "pr", number: prNotice, body: `Released: dev is back on ${open} at ${short(target)}.` }] : [],
    });
  };

  // ── a push to a train ─────────────────────────────────────────────────────
  if (event.kind === "push") {
    if (!open || event.branch !== open) {
      return res("noop", `${event.branch} is not the open train (${open ?? "none"}): dev follows the open train only`);
    }
    if (!box.readable) return res("wait", "dev has no readable release.json, so there is no carried commit to compare the box steps against: carry it by hand once");
    if (live) {
      return res("wait", `dev is held by PR #${holder.pr} (labelled by ${holder.by}); the train's carry waits and dev catches up when the label is removed`);
    }
    const target = trainHeads[open];
    if (!holder && sameSha(box.sha, target)) return res("noop", `dev already runs ${open} at ${short(target)}`);
    const s = steps(target);
    if (s.changed) {
      const msg = waitsForAHand(s, target, target);
      return res("wait", msg, { notices: [{ when: "now", to: "commit", sha: target, body: `${msg} Carry it by hand (deploy/dev-office-carry.sh), after the box steps; the follow resumes from that carry.` }] });
    }
    return res("carry", `dev follows ${open} to ${short(target)}`, { target: { tag: open, sha: target, ref: open }, holder: null });
  }

  // ── a pull request event ──────────────────────────────────────────────────
  const { action, labelName, sender, pr } = event;
  const labelled = pr.labels.includes(LABEL);
  const isHolder = Boolean(holder && holder.pr === pr.number);

  if ((action === "labeled" || action === "unlabeled") && labelName !== LABEL) return res("noop", `the ${labelName} label is not ${LABEL}`);

  // The label comes off, or the PR closes: if this PR holds dev, dev goes back to the open train.
  if (action === "unlabeled" || action === "closed") {
    if (!isHolder) return res("noop", `PR #${pr.number} does not hold dev`);
    return backToTrain(`PR #${pr.number} ${action === "closed" ? "closed" : "was unlabelled"}`, pr.number);
  }

  if (!labelled) return res("noop", `PR #${pr.number} does not carry ${LABEL}`);
  if (pr.state !== "open") return res("noop", `PR #${pr.number} is not open`);

  const refuse = (why) => res("refuse", why, { unlabel: [pr.number], notices: [{ when: "now", to: "pr", number: pr.number, body: `${why} The ${LABEL} label is removed.` }] });

  if (pr.headRepo !== repo) return refuse("A pull request from a fork never goes on dev.");
  if (action === "labeled" && !WRITERS.has(labelerPermission ?? "")) {
    return refuse(`Only someone with write access to ${repo} puts a PR on dev (${sender} has ${labelerPermission ?? "none that could be read"}).`);
  }
  if (!box.readable) return refuse("Dev has no readable release.json, so what dev runs is unknown: the dev office needs a hand carry first.");
  if (live && !isHolder) {
    return refuse(`Dev is held by PR #${holder.pr} (labelled by ${holder.by}, head ${short(holder.sha)}, since ${holder.since}). One holder at a time: ask for it again once #${holder.pr} releases dev.`);
  }

  const target = pr.headSha;
  if (isHolder && sameSha(box.sha, target)) return res("noop", `dev already runs PR #${pr.number} at ${short(target)}`);

  const s = steps(target);
  if (s.changed) {
    const msg = `${waitsForAHand(s, target, target)} The PR carries them, so a hand carries it to dev.`;
    return isHolder && live
      ? res("wait", msg, { notices: [{ when: "now", to: "pr", number: pr.number, body: `${msg} Dev keeps the previous head, ${short(box.sha)}.` }] })
      : refuse(msg);
  }

  const next = {
    pr: pr.number,
    by: action === "labeled" ? sender : holder?.by ?? sender,
    sha: target,
    since: isHolder && holder.since ? holder.since : now,
    prior: holder?.prior ?? { tag: box.tag, sha: box.sha },
  };
  return res("carry", `dev carries PR #${pr.number} at ${short(target)} for ${next.by}`, {
    target: { tag: `pr/${pr.number}`, sha: target, ref: `pull/${pr.number}/head` },
    holder: next,
    notices: [{ when: "after-carry", to: "pr", number: pr.number, body: `Dev runs this PR's head, ${short(target)}. It holds dev until the ${LABEL} label comes off or the PR closes; then dev returns to ${open ?? "the open train"}. One holder at a time.` }],
  });
}
