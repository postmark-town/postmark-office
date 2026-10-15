// bugs.mjs — THE BUG CLASS OF THE POST MACHINE (Posts phase 2, first slice), pure.
//
// Keemin, 2026-09-29 (the Posts project, § Ruled for phase 2): "Bugs pay the
// flat ladder, with no staking … it feels odd to wait for stakers for a clearly
// broken thing that just needs fixing, and ideally every bug gets fixed
// anyway." The first slice is the bug class plus a mint Wright reviews before
// it writes.
//
// ── THE LIFECYCLE ───────────────────────────────────────────────────────────
//
//   reported → confirmed → reproduced → diagnosed → briefed → fixed → shipped
//
// with two side exits from reported or confirmed: `duplicate` (naming the post
// it duplicates, `of`) and `not-a-bug`. Finished: shipped, duplicate, not-a-bug.
//
// Any resident posts a bug as themselves. The town's hands (BUG_HANDS) move it,
// and may also post one on a resident's behalf (`for`), crediting the reporter.
// An advance may jump forward; a stage it skips pays nothing.
//
// ── THE ADVANCE RECORDS; IT MINTS NOTHING ───────────────────────────────────
//
// Each advance act names the stage and whom it credits (`credit`), and at
// `briefed` the grade, at `fixed` the size and the critter the fixer named
// (POS-298; kept as fields.critter with fields.named_by). What a stage pays is the ladder
// below, and it is paid by a separate, reviewed pass (tools/bug-stage-plan.mjs)
// that reads these acts, so a door call never moves money. The town's own
// ledger holds the ladder again at verify (its stamp-mint.mjs § the stage
// grammar), so an amount this file and the town disagree on reds the verifier.
//
// ── NO STAKE ────────────────────────────────────────────────────────────────
//
// A bug takes no stake, at post and at the stake door alike, refused by name
// (BUG_NO_STAKE), with the ruling's reason in the refusal.

import { refuse, TITLE_MAX, INVITATION_MAX, ACT_POST, ACT_ADVANCE, ACT_RECREDIT } from "./events.mjs";
import { handsOf, holdsHand, notThisHand } from "./named-hand.mjs";

export const BUG_CLASS = "bug";

export const STATE_REPORTED = "reported";
export const STATE_CONFIRMED = "confirmed";
export const STATE_REPRODUCED = "reproduced";
export const STATE_DIAGNOSED = "diagnosed";
export const STATE_BRIEFED = "briefed";
export const STATE_FIXED = "fixed";
export const STATE_SHIPPED = "shipped";
export const STATE_DUPLICATE = "duplicate";
export const STATE_NOT_A_BUG = "not-a-bug";

/** The main line, in order. An advance moves forward along it and may skip. */
export const BUG_STAGES = Object.freeze([STATE_REPORTED, STATE_CONFIRMED, STATE_REPRODUCED, STATE_DIAGNOSED,
  STATE_BRIEFED, STATE_FIXED, STATE_SHIPPED]);
/** The side exits, and the states they leave from. */
export const BUG_SIDE_EXITS = Object.freeze([STATE_DUPLICATE, STATE_NOT_A_BUG]);
export const SIDE_EXIT_FROM = Object.freeze([STATE_REPORTED, STATE_CONFIRMED]);
/** Every state, and the ones a bug is finished in (the Posts project: "every class declares its finished states"). */
export const BUG_STATES = Object.freeze([...BUG_STAGES, ...BUG_SIDE_EXITS]);
export const BUG_FINISHED = Object.freeze([STATE_SHIPPED, STATE_DUPLICATE, STATE_NOT_A_BUG]);

// WHOSE HANDS MOVE A BUG (the brief, 2026-09-29). `bugcatcher` is the Bug
// Catcher meep, prepared in parallel. Widening it is a ruling, not a default.
export const BUG_HANDS = Object.freeze(["wright", "keemin", "bugcatcher"]);

export const BUG_SIZES = Object.freeze(["S", "M", "L"]);
export const BUG_GRADES = Object.freeze(["light", "heavy"]);

// THE FLAT LADDER (Everyone Builds v2, "really well calibrated", Keemin
// 2026-09-26; stands as ruled 2026-09-27 and 2026-09-29). `by` names the field
// that picks the amount; a stage with no `by` pays one amount. shipped and the
// side exits pay nothing and credit no one.
export const BUG_LADDER = Object.freeze({
  [STATE_CONFIRMED]: Object.freeze({ n: 2 }),
  [STATE_REPRODUCED]: Object.freeze({ n: 3 }),
  [STATE_DIAGNOSED]: Object.freeze({ n: 5 }),
  [STATE_BRIEFED]: Object.freeze({ by: "grade", n: Object.freeze({ light: 10, heavy: 5 }) }),
  [STATE_FIXED]: Object.freeze({ by: "size", n: Object.freeze({ S: 10, M: 25, L: 50 }) }),
});
/** The stages that pay, in lifecycle order. */
export const PAID_STAGES = Object.freeze(BUG_STAGES.filter((s) => BUG_LADDER[s]));

/** Three paid `confirmed` stages per household per week; later stages are uncapped (ruled 2026-09-27). */
export const CONFIRMED_CAP = 3;

/** What a stage pays, given the advance's own fields; 0 for a stage that pays nothing. */
export function stageAmount(stage, { size = null, grade = null } = {}) {
  const rung = BUG_LADDER[stage];
  if (!rung) return 0;
  if (!rung.by) return rung.n;
  return rung.n[rung.by === "size" ? size : grade] ?? 0;
}

// ── the text a bug carries ──────────────────────────────────────────────────

export const BODY_MAX = INVITATION_MAX;   // "an idea is a title plus a body of up to 600 characters" — a bug's the same
export const STEPS_MAX = 2000;
export const RECORD_MAX = 300;
/** A GitHub issue on the town's own org (the brief: `github.com/postmark-town/*`). */
export const ISSUE_RE = /^https:\/\/github\.com\/postmark-town\/[A-Za-z0-9._-]+\/issues\/\d+$/;
/** A handle as the town spells one: lowercase, digits, `-`, and the `.` some live handles carry. */
export const BUG_HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * The critter (POS-298, Keemin 2026-09-29): every caught bug becomes a small
 * critter for the town's jar, and the resident credited with the fix names it.
 * The town's hands record the name on the advance to fixed. It is text, never
 * HTML (the reading law): stored and returned exactly as sent, so whoever
 * paints it escapes it. It pays nothing; the ladder reads size and grade only.
 */
export const CRITTER_MAX = 40;
export const CRITTER_NAMER = "the resident who fixes a bug names it";
const CRITTER_HOW = `critter: "<name>", 1–${CRITTER_MAX} characters on one line — the fixer chooses it and tells the town's hands (${BUG_HANDS.join(", ")}) in the PR or the issue`;

export function judgeCritter(v) {
  if (v === undefined) throw refuse(422, `fixed needs a critter: ${CRITTER_NAMER}`, CRITTER_HOW, { field: "critter" });
  if (typeof v !== "string") throw refuse(422, "critter is text", CRITTER_HOW, { field: "critter" });
  const s = v.trim();
  if (!s) throw refuse(422, "critter is empty", CRITTER_HOW, { field: "critter" });
  if (/[\r\n]/.test(s)) throw refuse(422, "critter is one line", CRITTER_HOW, { field: "critter" });
  const n = [...s].length;
  if (n > CRITTER_MAX) throw refuse(422, `critter is at most ${CRITTER_MAX} characters`, `this one is ${n}`, { field: "critter" });
  return s;
}

/**
 * The link (Darko, 2026-10-07: "where the lifecycle pointers point TO"). The
 * post holds a bug's state and its GitHub issue is where the work happens, in
 * public: the cause, the fix brief, the PR. An advance may name the work that
 * earned its stage, on the town's own repos: the issue comment holding the
 * cause (diagnosed) or the fix brief (briefed), the PR (fixed), the release
 * tag (shipped). The post keeps one per stage in fields.links, so the record
 * points at everything the town paid for and the stage pass can check it.
 * Optional for confirmed, reproduced and shipped; diagnosed, briefed and fixed
 * need one, of their own kind, by the credited resident (POS-649, below).
 */
export const LINK_RE = /^https:\/\/github\.com\/postmark-town\/[A-Za-z0-9._-]+\/\S+$/;
export const LINK_MAX = RECORD_MAX;
export const LINK_WHAT = "the work that earned the stage, on github.com/postmark-town/: the issue comment with the cause (diagnosed) or the fix brief (briefed), the PR (fixed), the release tag (shipped)";
const LINK_HOW = `link: one URL — ${LINK_WHAT}`;

export function judgeLink(v) {
  if (typeof v !== "string") throw refuse(422, "link is text", LINK_HOW, { field: "link" });
  const s = v.trim();
  if (!s) throw refuse(422, "link is empty", "leave link off rather than sending it empty", { field: "link" });
  if (s.length > LINK_MAX) throw refuse(422, `link is at most ${LINK_MAX} characters`, `this one is ${s.length}`, { field: "link" });
  if (!LINK_RE.test(s)) throw refuse(422, "link points at the town's own repos", LINK_HOW, { field: "link" });
  return s;
}

// ── AN EARNED STAGE IS CHECKED AGAINST ITS WORK (POS-649, a hotfix) ─────────
//
// Darko, 2026-10-15 12:37: "a deterministic check, not tighter wording …
// pretty much every mistake that is made is irreversible." On 10-14 a hand
// advanced #3757 to briefed crediting wright and linked wright's own PR, while
// the brief was Kino's letter; the pass minted 10 stamps the ledger can't take
// back. So diagnosed, briefed and fixed each need a link, the link's kind must
// fit the stage, and the credited resident must be its author
// (bug-credit.mjs § judgeEarnedCredit reads the author and judges the binding).
// Confirmed, reproduced, shipped and the side exits are left as they were.
//
// A RESIDENT'S OWN PULL REQUEST EARNS DIAGNOSED OR BRIEFED TOO (RULED, Darko
// 2026-10-15 19:02 EDT, on review-649 § 2: the replay of 59 live advances found
// 6 legitimate lupi and little-bird credits linking their own PRs, refused by
// "never a PR"). A
// founder account's PR never earns diagnosed or briefed for anyone, so #3757's
// link (wright-starforge's world#208) stays refused (bug-credit.mjs).
// AND A COMMENT OR ISSUE LINK IS ON THE BUG'S OWN ISSUE when the bug names one
// (fields.issue): work on another issue earned another bug's stage.
export const EARNED_STAGES = Object.freeze([STATE_DIAGNOSED, STATE_BRIEFED, STATE_FIXED]);

/** What earns each checked stage, in the words every refusal teaches with. */
export const EARNED_BY = Object.freeze({
  [STATE_DIAGNOSED]: "diagnosed is earned by the cause: link the issue comment, the issue, the letter, or the resident's own pull request that names it; its author is who's credited, and a founder's pull request never earns it",
  [STATE_BRIEFED]: "briefed is earned by the brief: link the issue comment, the issue, the letter, or the resident's own pull request that holds it; its author is who's credited, and a founder's pull request never earns it",
  [STATE_FIXED]: "fixed is earned by the fix: link its pull request; its author is who's credited",
});
const EARNED_SHAPES = Object.freeze({
  [STATE_DIAGNOSED]: 'link: "https://github.com/postmark-town/<repo>/issues/<n>#issuecomment-<id>", ".../issues/<n>", ".../pull/<n>", or a letter\'s id',
  [STATE_BRIEFED]: 'link: "https://github.com/postmark-town/<repo>/issues/<n>#issuecomment-<id>", ".../issues/<n>", ".../pull/<n>", or a letter\'s id',
  [STATE_FIXED]: 'link: "https://github.com/postmark-town/<repo>/pull/<n>"',
});
const EARNED_KINDS = Object.freeze({
  [STATE_DIAGNOSED]: Object.freeze(["comment", "issue", "letter", "pull"]),
  [STATE_BRIEFED]: Object.freeze(["comment", "issue", "letter", "pull"]),
  [STATE_FIXED]: Object.freeze(["pull"]),
});
const KIND_NAME = Object.freeze({ comment: "an issue comment", issue: "an issue", pull: "a pull request", letter: "a letter" });

/** The founders' GitHub accounts, by id (the login is a label), and the handles they credit. */
export const FOUNDER_ACCOUNTS = Object.freeze({ 306351151: "wright-starforge", 67605380: "keeminlee" });
export const FOUNDER_HANDLES = Object.freeze(["wright", "keemin"]);

// A repo name never starts with a dot, so `.` and `..` can never steer the API path (review-649 § 6).
const REPO = "([A-Za-z0-9_-][A-Za-z0-9._-]*)";
const COMMENT_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/issues/(\\d+)#issuecomment-(\\d+)$`);
const ISSUE_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/issues/(\\d+)$`);
const PULL_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/pull/(\\d+)$`);
/** A letter's id, as the town spells one (`<from>-<date>-to-<to>-<slug>`): no slash, no colon. */
const LETTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What a link names: `{ kind, repo?, number?, comment?, id? }`, or null for no shape we read. */
export function earnedRef(s) {
  let m;
  if ((m = COMMENT_LINK_RE.exec(s))) return { kind: "comment", repo: m[1], number: Number(m[2]), comment: m[3] };
  if ((m = ISSUE_LINK_RE.exec(s))) return { kind: "issue", repo: m[1], number: Number(m[2]) };
  if ((m = PULL_LINK_RE.exec(s))) return { kind: "pull", repo: m[1], number: Number(m[2]) };
  if (LETTER_ID_RE.test(s)) return { kind: "letter", id: s };
  return null;
}

/**
 * The link an earned stage needs: present, and of the kind the stage is earned
 * by. Returns `{ link, ref }`; whose work it is is judged with the store and
 * GitHub (bug-credit.mjs), never here.
 */
export function judgeEarnedLink(to, v) {
  const how = `${EARNED_BY[to]} — ${EARNED_SHAPES[to]}`;
  if (v === undefined) throw refuse(422, `${to} needs a link to the work that earned it`, how, { field: "link" });
  if (typeof v !== "string") throw refuse(422, "link is text", how, { field: "link" });
  const s = v.trim();
  if (!s) throw refuse(422, `${to} needs a link to the work that earned it`, how, { field: "link" });
  if (s.length > LINK_MAX) throw refuse(422, `link is at most ${LINK_MAX} characters`, `this one is ${s.length}`, { field: "link" });
  const ref = earnedRef(s);
  if (!ref) throw refuse(422, `${to}'s link is not one the office can read`, how, { field: "link" });
  if (!EARNED_KINDS[to].includes(ref.kind))
    throw refuse(422, `${to} is earned by a pull request, and this link is ${KIND_NAME[ref.kind]}`, how, { field: "link" });
  return { link: s, ref };
}

/**
 * A comment or issue link is on the bug's own issue, when the bug names one
 * (fields.issue). A bug with no issue named takes the link as it is; a PR or a
 * letter is not judged here.
 */
export function judgeOnBugIssue(to, link, ref, prev) {
  if (ref?.kind !== "comment" && ref?.kind !== "issue") return;
  const m = /^https:\/\/github\.com\/postmark-town\/([A-Za-z0-9._-]+)\/issues\/(\d+)$/.exec(String(prev?.fields?.issue ?? ""));
  if (!m) return;
  if (m[1].toLowerCase() === ref.repo.toLowerCase() && Number(m[2]) === ref.number) return;
  throw refuse(422, `${link} is on ${ref.repo}#${ref.number}, and "${prev.id}" is ${m[1]}#${m[2]}`,
    `${EARNED_BY[to]} — link the work on this bug's own issue, ${prev.fields.issue}`, { field: "link" });
}

/** The fields a bug's reporter may send and amend, beside title and body. */
export const BUG_FIELDS = Object.freeze(["issue", "steps", "record"]);

function oneLine(name, v, max) {
  if (typeof v !== "string") throw refuse(422, `${name} is text`, `${name}: one line of text`, { field: name });
  const s = v.trim();
  if (!s) throw refuse(422, `${name} is empty`, `leave ${name} off rather than sending it empty`, { field: name });
  if (s.length > max) throw refuse(422, `${name} is at most ${max} characters`, `this one is ${s.length}`, { field: name });
  if (/[\r\n]/.test(s)) throw refuse(422, `${name} is one line`, `${name} names one thing: an act id, a receipt path or a URL`, { field: name });
  return s;
}

/**
 * Judge a bug's text. `partial` is the amendment: only what was sent is judged
 * and returned. Returns `{ title?, body?, fields: { issue?, steps?, record? } }`.
 */
export function judgeBugText(input, { partial = false } = {}) {
  const out = { fields: {} };
  if (input.title !== undefined || !partial) {
    const t = typeof input.title === "string" ? input.title.trim() : "";
    if (!t) throw refuse(422, "a bug needs a title", "title: what is broken, in a few words", { field: "title" });
    if (t.length > TITLE_MAX) throw refuse(422, `a title is at most ${TITLE_MAX} characters`, `this one is ${t.length}`, { field: "title" });
    out.title = t;
  }
  if (input.body !== undefined || !partial) {
    const b = typeof input.body === "string" ? input.body.trim() : "";
    if (!b) throw refuse(422, "a bug needs a body", `body: what you saw and what you expected, at most ${BODY_MAX} characters`, { field: "body" });
    if (b.length > BODY_MAX) throw refuse(422, `a bug's body is at most ${BODY_MAX} characters`, `this one is ${b.length} — put the steps in steps:, and link the discussion with issue:`, { field: "body" });
    out.body = b;
  }
  if (input.issue !== undefined) {
    const s = typeof input.issue === "string" ? input.issue.trim() : "";
    if (!ISSUE_RE.test(s))
      throw refuse(422, "issue is a GitHub issue on the town's own repos", "issue: \"https://github.com/postmark-town/<repo>/issues/<n>\"", { field: "issue" });
    out.fields.issue = s;
  }
  if (input.steps !== undefined) {
    if (typeof input.steps !== "string" || !input.steps.trim()) throw refuse(422, "steps is text", "steps: how to make it happen, in your own words", { field: "steps" });
    const s = input.steps.trim();
    if (s.length > STEPS_MAX) throw refuse(422, `steps is at most ${STEPS_MAX} characters`, `this one is ${s.length}`, { field: "steps" });
    out.fields.steps = s;
  }
  if (input.record !== undefined) out.fields.record = oneLine("record", input.record, RECORD_MAX);
  return out;
}

/**
 * A handle named in `for` or `credit`: the town's spelling, AND a resident
 * standing in the office's residents index (Wright's review of #257: a handle
 * that is no one records, and the town's --stage-mint later dies on it with
 * "no WHITE_PAGES room"). `roll` is that index's handles; when the office
 * cannot read it, the act refuses rather than guessing.
 */
export function judgeHandleField(name, v, roll) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!BUG_HANDLE_RE.test(s)) throw refuse(422, `${name} names a resident by handle`, `${name}: "<handle>", as the town's white pages spell it`, { field: name });
  if (!roll) throw refuse(503, `the office cannot read its residents index, so it cannot check "${s}"`, "nothing was written — ask again shortly", { field: name });
  if (!roll.has(s)) throw refuse(422, `"${s}" is not a resident here`, `${name}: the resident's handle as the white pages spell it — town { read: "residents" } lists them`, { field: name });
  return s;
}

/**
 * The hand: the caller's resident, who must be one of BUG_HANDS. The same rule
 * as the quest's (quests.mjs § judgeQuestHand): the named handle if it is
 * yours, your only one, or the one of yours that is a hand.
 */
export function judgeBugHand(fields, key, { act }) {
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const hand = named || (held.length === 1 ? held[0] : [...handsOf(key)].find((h) => BUG_HANDS.includes(h)) ?? "");
  if (!hand || !BUG_HANDS.includes(hand))
    throw refuse(403, `only the town's hands ${act}`,
      `a bug is moved along its life by ${BUG_HANDS.join(", ")}; anyone may post one as themselves with town { do: "post", args: { class: "bug", title, body } }`);
  // POS-389: the hand is this credential's own, not a housemate it lists.
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw refuse(403, r.defect, r.hint); }
  return hand;
}

/**
 * Judge an advance against the post's current state. Returns the payload's
 * judged parts: `{ to, credit, size?, critter?, grade?, of?, link?, earned? }`
 * (`earned`: what an earned stage's link names, for bug-credit.mjs). `reporter` is the post's
 * author, the credit a `confirmed` defaults to.
 */
export function judgeAdvance(fields, prev, roll) {
  const to = typeof fields?.to === "string" ? fields.to.trim() : "";
  if (!to) throw refuse(422, "advance to which stage?", `to: one of ${BUG_STATES.filter((s) => s !== STATE_REPORTED).join(", ")}`, { field: "to" });
  if (!BUG_STATES.includes(to) || to === STATE_REPORTED)
    throw refuse(422, `"${to}" is not a stage a bug advances to`, `to: one of ${BUG_STATES.filter((s) => s !== STATE_REPORTED).join(", ")}`, { field: "to" });
  const from = prev.state;
  if (BUG_FINISHED.includes(from))
    throw refuse(409, `"${prev.id}" is finished (${from})`, "a finished bug moves no further; post a new one if it came back");
  if (BUG_SIDE_EXITS.includes(to)) {
    if (!SIDE_EXIT_FROM.includes(from))
      throw refuse(409, `a bug leaves as ${to} only from ${SIDE_EXIT_FROM.join(" or ")}`, `"${prev.id}" stands ${from}; move it forward along ${BUG_STAGES.join(" → ")}`, { field: "to" });
  } else if (BUG_STAGES.indexOf(to) <= BUG_STAGES.indexOf(from)) {
    throw refuse(409, `"${prev.id}" already stands ${from}`, `an advance moves forward: ${BUG_STAGES.slice(BUG_STAGES.indexOf(from) + 1).join(", ")}`, { field: "to" });
  }
  const out = { to };
  const paid = Boolean(BUG_LADDER[to]);
  if (fields.credit !== undefined && !paid)
    throw refuse(422, `${to} pays nothing and credits no one`, "leave credit off", { field: "credit" });
  if (paid) {
    if (fields.credit !== undefined) out.credit = judgeHandleField("credit", fields.credit, roll);
    else if (to === STATE_CONFIRMED) out.credit = prev.author;
    else throw refuse(422, `${to} names whom it credits`, `credit: "<handle>" — the resident who did the stage (from reproduced onward it is always named)`, { field: "credit" });
  }
  if (fields.size !== undefined && to !== STATE_FIXED) throw refuse(422, "size is fixed's", "only an advance to fixed takes size (S, M or L)", { field: "size" });
  if (fields.grade !== undefined && to !== STATE_BRIEFED) throw refuse(422, "grade is briefed's", "only an advance to briefed takes grade (light or heavy)", { field: "grade" });
  if (fields.critter !== undefined && to !== STATE_FIXED) throw refuse(422, `critter is fixed's: ${CRITTER_NAMER}`, "only an advance to fixed takes critter", { field: "critter" });
  if (to === STATE_FIXED) {
    if (!BUG_SIZES.includes(fields.size)) throw refuse(422, "fixed needs a size", `size: one of ${BUG_SIZES.join(", ")} — it picks the stamps (${BUG_SIZES.map((s) => `${s} ${BUG_LADDER.fixed.n[s]}`).join(", ")})`, { field: "size" });
    out.size = fields.size;
    out.critter = judgeCritter(fields.critter);
  }
  if (to === STATE_BRIEFED) {
    if (!BUG_GRADES.includes(fields.grade)) throw refuse(422, "briefed needs a grade", `grade: ${BUG_GRADES.join(" or ")} — the bless's revision (${BUG_GRADES.map((g) => `${g} ${BUG_LADDER.briefed.n[g]}`).join(", ")})`, { field: "grade" });
    out.grade = fields.grade;
  }
  if (EARNED_STAGES.includes(to)) {
    const e = judgeEarnedLink(to, fields.link);
    judgeOnBugIssue(to, e.link, e.ref, prev);
    out.link = e.link;
    out.earned = e.ref;
  } else if (fields.link !== undefined) out.link = judgeLink(fields.link);
  if (fields.of !== undefined && to !== STATE_DUPLICATE) throw refuse(422, "of is duplicate's", "only an advance to duplicate names the post it duplicates", { field: "of" });
  if (to === STATE_DUPLICATE) {
    const of = typeof fields.of === "string" ? fields.of.trim() : "";
    if (!of) throw refuse(422, "a duplicate names the bug it duplicates", "of: \"<author>/<slug>\", the standing bug post", { field: "of" });
    if (of === prev.id) throw refuse(422, "a bug is not a duplicate of itself", "of: the other bug post", { field: "of" });
    out.of = of;
  }
  return out;
}

// ── THE RECREDIT (POS-649, a hotfix; Darko 2026-10-15) ──────────────────────
//
// Darko 12:40: "I should not have to hand gift Kino in these situations." And
// 12:51: "the mint to kino to give them the 10 … burning the 10 that you
// mistakenly got." A stage paid to the wrong resident is re-credited at the
// advance door, `{ post, to: <the stage>, recredit: true, credit, link, note }`,
// and recorded as its own `recredit` act: the old advance is never rewritten.
// The reviewed stage pass (tools/bug-stage-plan.mjs) then writes the town's two
// lines together under the town lock: the stage's amount to the new credit
// (`post:<id>/<stage>-recredit`) and the wrong mint burned, exactly (the town's
// stamp-mint.mjs § THE BUG STAGE CORRECTION). The new credit passes the same
// author check as an advance (bug-credit.mjs). Only diagnosed, briefed and
// fixed; only a stage the post passed and that paid someone; once per stage.
//
// The hands are wright and keemin only: a recredit burns stamps, and the town
// gives moving money to them alone (AWARD_HANDS, its CORRECTION_HANDS).
export const RECREDIT_HANDS = Object.freeze(["wright", "keemin"]);
export const RECREDIT_NOTE_MAX = BODY_MAX;
const RECREDIT_HOW = `town { do: "advance", args: { post, to: "${EARNED_STAGES.join("\" | \"")}", recredit: true, credit, link, note } }`;
const payloadOfAct = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));

/** A recredit's own fields, judged before the store is read: `{ to, credit, link, earned, note }`. */
export function judgeRecreditFields(fields, roll) {
  if (fields.recredit !== true) throw refuse(422, "recredit is true, or left off", RECREDIT_HOW, { field: "recredit" });
  const to = typeof fields.to === "string" ? fields.to.trim() : "";
  if (!EARNED_STAGES.includes(to))
    throw refuse(422, `only ${EARNED_STAGES.join(", ")} are re-credited`, `to: the stage whose credit was wrong — ${RECREDIT_HOW}`, { field: "to" });
  for (const k of ["size", "grade", "critter", "of"])
    if (fields[k] !== undefined)
      throw refuse(422, `a recredit takes no ${k}`, `it pays the stage again at exactly what the stage paid — ${RECREDIT_HOW}`, { field: k });
  if (fields.credit === undefined)
    throw refuse(422, "a recredit names whom it credits", `credit: the resident whose work earned ${to} — ${RECREDIT_HOW}`, { field: "credit" });
  const credit = judgeHandleField("credit", fields.credit, roll);
  // A founder may be the new credit (RULED, Darko 2026-10-15 19:02 EDT: "sure
  // whatever"; the w42.6 hotfix refused one). The author check still holds: a
  // founder is credited only by a founder's own work (bug-credit.mjs).
  const e = judgeEarnedLink(to, fields.link);
  const note = typeof fields.note === "string" ? fields.note.trim() : "";
  if (!note)
    throw refuse(422, "a recredit says why", `note: what the stage's credit got wrong, at most ${RECREDIT_NOTE_MAX} characters; it stays on the bug's history beside both credits`, { field: "note" });
  if (note.length > RECREDIT_NOTE_MAX)
    throw refuse(422, `a recredit's note is at most ${RECREDIT_NOTE_MAX} characters`, `this one is ${note.length}`, { field: "note" });
  return { to, credit, link: e.link, earned: e.ref, note };
}

/**
 * Judge a recredit against the bug. `acts` are the post's advance and recredit
 * acts, oldest first; `paid` is what the chain's stage lines paid,
 * Map("<post>/<stage>" → n), or null when the chain can't be read. Returns
 * `{ was, n }`: the stage's credit now, and what the chain says it paid (null
 * when the chain doesn't say; the stage pass reads the ledger either way).
 */
export function judgeRecredit(r, prev, acts, paid) {
  const id = prev.id;
  judgeOnBugIssue(r.to, r.link, r.earned, prev);
  const adv = acts.find((a) => a.action === ACT_ADVANCE && payloadOfAct(a).to === r.to);
  if (!adv) {
    const ahead = BUG_STAGES.indexOf(prev.state) < BUG_STAGES.indexOf(r.to);
    throw refuse(409, `"${id}" never passed ${r.to}`, ahead
      ? `it stands ${prev.state}; advance it to ${r.to}, crediting the right resident, rather than re-crediting`
      : `${r.to} was skipped, and a skipped stage paid no one: there is nothing to re-credit`, { field: "to" });
  }
  const done = acts.find((a) => a.action === ACT_RECREDIT && payloadOfAct(a).to === r.to);
  if (done)
    throw refuse(409, `"${id}"'s ${r.to} was already re-credited, to ${payloadOfAct(done).credit}`, "one recredit per post and stage, ever: the town burns a mint once", { field: "to" });
  const was = payloadOfAct(adv).credit ?? null;
  if (r.credit === was)
    throw refuse(422, `${r.to} on "${id}" already credits ${was}`, "a recredit names someone else: the resident whose work earned the stage", { field: "credit" });
  // WHAT THE STAGE PAID IS THE PASS'S TO READ (review-3842-578 § 1). Prod's
  // store holds no stamp chain yet (STAMP_LINES is off), so a door that gated
  // on it refused every recredit. The act records what the chain says when it
  // can (`n`, else null), and the stage pass reads the town's ledger itself:
  // it corrects only a stage line paid to `was`, and holds anything else.
  return { was, n: paid?.get(`${id}/${r.to}`) ?? null };
}

// ── THE REVEAL AT SHIP (Keemin, 2026-09-26, on POS-236) ─────────────────────
//
// "At SHIP the image is revealed … three candidates painted by Iris from the
// critter's description, the resident choosing. The Bug Catcher keeps the jar;
// Iris paints." Iris is asked by letter and answers with three media URLs; a
// town hand (the Bug Catcher, who keeps the jar) sets them on the post, and the
// fixer who named the critter picks one. Each is one `reveal` act; the post's
// `fields.reveal` holds { candidates, pick, image, picked_by }, and the jar reads
// the picked image off the post. Chosen once: a picked reveal takes no second act.

export const REVEAL_CANDIDATES = 3;
const REVEAL_HOW = `town { do: "reveal", args: { post, candidates: [three media URLs] } } by the town's hands (${BUG_HANDS.join(", ")}), then { post, pick: 1–${REVEAL_CANDIDATES} } by the fixer who named the critter`;

/**
 * Judge a reveal against the post. Returns `{ actor, reveal }`: who acts, and the
 * post's whole reveal after this act. `urlOk` is the media door's own check
 * (media.mjs § mediaUrlOk), passed in so this file stays pure.
 */
export function judgeReveal(fields, prev, key, { urlOk }) {
  const has = (k) => fields?.[k] !== undefined;
  if (has("candidates") === has("pick"))
    throw refuse(422, "a reveal sets the candidates or makes the pick, one at a time", REVEAL_HOW);
  if (prev.state !== STATE_SHIPPED)
    throw refuse(409, `"${prev.id}" stands ${prev.state}, and a critter is revealed when its fix ships`, "advance it to shipped first");
  const was = prev.fields?.reveal ?? null;
  if (was?.pick) throw refuse(409, `"${prev.id}"'s critter is revealed`, "its image was chosen once, by its fixer");

  if (has("candidates")) {
    const actor = judgeBugHand(fields, key, { act: "set a critter's candidates" });
    const list = Array.isArray(fields.candidates) ? fields.candidates.map((u) => (typeof u === "string" ? u.trim() : u)) : null;
    if (!list || list.length !== REVEAL_CANDIDATES)
      throw refuse(422, `a reveal holds ${REVEAL_CANDIDATES} candidates`, "candidates: the three media URLs Iris answered with", { field: "candidates" });
    const bad = list.find((u) => !urlOk(u));
    if (bad !== undefined)
      throw refuse(422, "a candidate is a media URL", `each is a URL the media door answered with (upload_media); "${String(bad).slice(0, 80)}" is not`, { field: "candidates" });
    if (new Set(list).size !== list.length) throw refuse(422, "the candidates are three different images", "candidates: three distinct URLs", { field: "candidates" });
    return { actor, reveal: { candidates: list, pick: null, image: null, picked_by: null } };
  }

  const fixer = prev.fields?.named_by ?? null;
  if (!was?.candidates) throw refuse(409, `"${prev.id}" has no candidates yet`, "Iris paints three once the fix ships; a town hand sets them on the post");
  if (!fixer) throw refuse(409, `"${prev.id}" names no fixer to choose`, "the critter's namer, set at fixed, makes the pick");
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const actor = named || (held.includes(fixer) ? fixer : "");
  if (actor !== fixer) throw refuse(403, `only ${fixer}, who fixed it and named the critter, picks its image`, `${fixer} picks with { post, pick }`);
  const n = Number(fields.pick);
  if (!Number.isInteger(n) || n < 1 || n > REVEAL_CANDIDATES)
    throw refuse(422, `pick is 1–${REVEAL_CANDIDATES}`, "pick: the candidate's place in the list, from 1", { field: "pick" });
  return { actor, reveal: { candidates: was.candidates, pick: n, image: was.candidates[n - 1], picked_by: actor } };
}

// ── THE HISTORY (POS-547, Darko 2026-10-09) ─────────────────────────────────
//
// "Clicking a bug shows what stage it's at, who contributed each earlier
// stage, and where the links lead." Credit is the public record, so the bug
// read carries it: one row per stage act, oldest first,
//
//   { stage, at, hand, credit, link, stamps_paid }
//
//   the post      stage `reported`; credit is the reporter (the act's actor),
//                 hand the town hand who put it up `for:` them, else null
//   an advance    stage is its `to`; credit and hand as the act recorded them
//                 (shipped and the side exits credit no one: null); link is
//                 the one the advance named for its own stage (the act carries
//                 the post's whole `links` map after it, so it is `links[to]`)
//   stamps_paid   the amount on the signed ledger's `post:<id>/<stage>` line,
//                 or null: not paid yet (the tick pays within about fifteen
//                 minutes), held by the weekly household cap, a meep's stage,
//                 or a stage that pays nothing
//
//   a recredit    (POS-649) its own row beside the stage it corrects:
//                 { stage, recredit: true, at, hand, credit, was, link, note,
//                 stamps_paid } (the `post:<id>/<stage>-recredit` line), and the
//                 corrected row gains `recredited_to`; neither is rewritten
//
// Amends and reveals move no stage, so they are not history rows; what they
// set is on the post's fields. The line's grammar is the town's (stamp-mint.mjs
// § STAGE_RE); it is read here only to find what a stage paid.

const STAGE_LINE_RE = new RegExp(String.raw`^- \d{4}-\d{2}-\d{2} · MINT → (\S+) · ([1-9]\d*) · for: post:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*)\/(${PAID_STAGES.join("|")}) · by: \S+$`);

/** A ledger line's stage payment, `{ post, stage, handle, n }`, or null for any other line. */
export function stagePaidOf(canonical) {
  const m = STAGE_LINE_RE.exec(String(canonical ?? ""));
  return m ? { handle: m[1], n: Number(m[2]), post: m[3], stage: m[4] } : null;
}

// A stage's correction line (the town's stamp-mint.mjs § RECREDIT_RE, POS-649):
// what the recredit paid, read the same way and keyed `<post>/<stage>-recredit`.
const RECREDIT_LINE_RE = new RegExp(String.raw`^- \d{4}-\d{2}-\d{2} · MINT → (\S+) · ([1-9]\d*) · for: post:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*)\/(${EARNED_STAGES.join("|")})-recredit · by: the-town$`);

/** A ledger line's recredit payment, `{ post, stage, handle, n }`, or null for any other line. */
export function recreditPaidOf(canonical) {
  const m = RECREDIT_LINE_RE.exec(String(canonical ?? ""));
  return m ? { handle: m[1], n: Number(m[2]), post: m[3], stage: m[4] } : null;
}

/**
 * Every bug's history, PURE. `acts` are the class's acts on the posts asked
 * (any action, oldest first by id); `paid` is what the chain's post lines paid,
 * Map("<post>/<stage>" → n), as post-history.mjs § postPaymentsVia reads it —
 * or the ledger's canonical lines themselves, read here. Returns Map(post id → rows).
 */
export function bugHistoryOf(acts, paid = []) {
  if (!(paid instanceof Map)) {
    const lines = paid;
    paid = new Map();
    for (const l of lines) {
      const s = stagePaidOf(l);
      if (s) paid.set(`${s.post}/${s.stage}`, s.n);
      const r = recreditPaidOf(l);
      if (r) paid.set(`${r.post}/${r.stage}-recredit`, r.n);
    }
  }
  const out = new Map();
  for (const a of acts) {
    if (a.action !== ACT_POST && a.action !== ACT_ADVANCE && a.action !== ACT_RECREDIT) continue;
    const p = typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {});
    const post = String(a.object);
    const at = new Date(a.at).toISOString();
    const rows = out.get(post) ?? [];
    // POS-649: a recredit is its own row, beside the stage it corrects, and
    // that row says where its credit went; neither is rewritten. stamps_paid
    // is the recredit's own line. The burn of the wrong mint is the town's,
    // and the original row's stamps_paid stays what that line paid.
    if (a.action === ACT_RECREDIT) {
      rows.push({ stage: p.to, recredit: true, at, hand: p.hand ?? a.actor ?? null, credit: p.credit ?? null, was: p.was ?? null,
        link: p.link ?? null, note: p.note ?? null, stamps_paid: paid.get(`${post}/${p.to}-recredit`) ?? null });
      const original = rows.find((r) => r.stage === p.to && !r.recredit);
      if (original) original.recredited_to = p.credit ?? null;
      out.set(post, rows);
      continue;
    }
    const row = a.action === ACT_POST
      ? { stage: STATE_REPORTED, at, hand: p.hand ?? null, credit: a.actor ?? null, link: null, stamps_paid: null }
      : { stage: p.to, at, hand: p.hand ?? a.actor ?? null, credit: p.credit ?? null,
        link: p.fields?.links?.[p.to] ?? null, stamps_paid: paid.get(`${post}/${p.to}`) ?? null };
    rows.push(row);
    out.set(post, rows);
  }
  return out;
}

// ── THE JAR'S ORDER (POS-558, Wright's review of #481, 2026-10-10) ──────────
//
// The bug read pages, so its order is what a resident walks page after page,
// and it is the jar's, in four groups:
//
//   1. open bugs, the furthest stage first (fixed … reported)
//   2. finished bugs with a name (a critter), the caught ones in the jar
//   3. the legacy shelf: finished with no name (fixed or shipped without a
//      critter; a critter is named only at fixed, so these never will be)
//   4. set aside: duplicate, not a bug
//
// newest first within each (the post's latest act), then by id. This order is
// the bug read's own; the shared postOrder, which events and quests read, is
// untouched.

const BUG_STAGE_RANK = new Map(BUG_STAGES.map((s, i) => [s, i]));
/** A bug row's group in the jar's order: 0 open, 1 named and finished, 2 legacy, 3 set aside. */
export function bugGroupOf(row) {
  if (BUG_SIDE_EXITS.includes(row.state)) return 3;
  const named = typeof row.fields?.critter === "string" && row.fields.critter.trim() !== "";
  if (row.state === STATE_SHIPPED) return named ? 1 : 2;
  if (row.state === STATE_FIXED && !named) return 2;
  return 0;
}
/** The bug read's comparator: group, then (open) the furthest stage, then newest, then id. */
export function bugJarOrder(a, b) {
  const ga = bugGroupOf(a), gb = bugGroupOf(b);
  return (ga - gb)
    || (ga === 0 ? (BUG_STAGE_RANK.get(b.state) ?? -1) - (BUG_STAGE_RANK.get(a.state) ?? -1) : 0)
    || String(b.latest?.at ?? "").localeCompare(String(a.latest?.at ?? ""))
    || String(a.id).localeCompare(String(b.id));
}

// ── THE CATCHERS (POS-558, Darko 2026-10-10) ────────────────────────────────
//
// "The Bug Catchers' Hall of Fame … residents in order of amount of stamp
// contribution towards bugs." The bug read pages (town-posts.mjs § THE BUG
// READ PAGES), and a page cannot add up the town, so every page carries the
// totals over the whole record, from the same history credits and
// stamps_paid: one row per handle credited on any bug,
//
//   { handle, stamps, bugs }
//
//   stamps  the sum of stamps_paid on the history rows that credit them; null
//           when the chain cannot be read (the read's `unavailable`), never 0
//   bugs    the posts they hold a credit on (the post's row credits its reporter)
//
// A bug set aside (duplicate, not a bug) credits only a stage that paid: a
// withdrawn report is not a catch. Every credited handle is listed, the town's
// hands too; whom to rank is the reader's call (the site ranks no meep and no
// founder). Ordered by stamps, then bugs, then handle.

/** The Hall's totals over every bug post (each carrying its `history`), PURE. */
export function bugCatchersOf(posts, { unavailable = false } = {}) {
  const by = new Map();
  for (const p of posts) {
    const aside = BUG_SIDE_EXITS.includes(p.state);
    for (const h of p.history ?? []) {
      if (!h?.credit) continue;
      // A stage re-credited counts for its recredit's resident (that row), never
      // the one it was taken from: the town burned that mint (POS-649).
      if (h.recredited_to) continue;
      const paid = Number.isInteger(h.stamps_paid) && h.stamps_paid > 0 ? h.stamps_paid : 0;
      if (aside && !paid) continue;
      const r = by.get(h.credit) ?? { handle: h.credit, stamps: 0, posts: new Set() };
      r.stamps += paid;
      r.posts.add(p.id);
      by.set(h.credit, r);
    }
  }
  return [...by.values()]
    .map(({ handle, stamps, posts: credited }) => ({ handle, stamps: unavailable ? null : stamps, bugs: credited.size }))
    .sort((a, b) => (b.stamps ?? 0) - (a.stamps ?? 0) || b.bugs - a.bugs || a.handle.localeCompare(b.handle));
}

// ── the refusals for what a bug does not take ───────────────────────────────

export const NO_STAKE_REASON = "Keemin, 2026-09-29: \"it feels odd to wait for stakers for a clearly broken thing that just needs fixing, and ideally every bug gets fixed anyway\"";
export const BUG_NO_STAKE = (id = null) => refuse(422, id ? `"${id}" is a bug, and a bug takes no stake` : "a bug takes no stake",
  `a bug's stages pay the flat ladder, so there is nothing to back — ${NO_STAKE_REASON}. Help it along instead: steps, a record, or the fix`);
export const BUG_NO_CLOSE = (id) => refuse(422, `"${id}" is a bug, and a bug is not closed`,
  `it finishes by advance: town { do: "advance", args: { post, to: "shipped" | "duplicate" | "not-a-bug" } }, by the town's hands (${BUG_HANDS.join(", ")})`);
