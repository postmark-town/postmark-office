// idea-mark-conversion.mjs — THE THINK TANK'S IDEA MARKS BECOME THEIR AUTHORS' IDEA POSTS (POS-854).
//
// Darko, 2026-11-16 22:44 EST: "Oh, yeah, no consent chase. And the idea, stakes carry over, exactly,
// like you said." Each standing resident idea mark becomes its author's own idea post, keeping where it came
// from (the mark's id, date, body and author); the author is told; and the escrow on the mark moves to the
// post with each staker's position intact. The mark's withdrawal is the world half's (Bevel's, at a crossing).
//
// This file is the PLAN and the STEPS, pure over what they are handed; the operator tool
// (tools/convert-idea-marks.mjs) is what reads the world and the ledger and what runs them.
//
// ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
//   · it does not withdraw a mark, edit the world or touch a class node (the world half);
//   · it does not write as the author: the post is put up by the town's hand (the `for` path's own shape:
//     the author is the actor, and the act's payload names `hand`), so it is no fresh creative act of theirs;
//   · it does not mint, burn or lose a stamp: the carry is `world-unstake` + `post-stake` pairs, planned and
//     proved conservative before one line is signed (post-stake-engine.mjs § planCarry);
//   · it does not send the notice. It drafts it.
//
// ── ONE ID, MINTED ONCE ─────────────────────────────────────────────────────
// A post's id is minted by the pen's own rule (idea-store.mjs § mintIdeaId: `<author>/<slug>` from the title,
// `-2`, `-3` while held, never one a mark holds), never the mark's id (the mark stands until the world half
// withdraws it, and a stake is keyed by id). The plan names the id; the step REFUSES to create any other, and
// a rerun finds the post by its provenance (`fields.origin.mark`), never by minting again.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { slugFromTitle, TITLE_MAX } from "./events.mjs";
import { BODY_MAX } from "./ideas.mjs";
import { planCarry, CONVERSION_VIA } from "./post-stake-engine.mjs";

export const SOURCE_NOTE = "marks standing at the world clone's ref: every WORLD/marks/**/mark.md whose frontmatter says `class: idea` and kind sited or predicated (the class mark `the-town/idea` declares the class and is not an idea)";

/** Which provenance the post carries: the mark it was, as it stood. `date` is the mark's own, never the conversion's. */
export const originOf = (m) => ({
  mark: m.mark, kind: m.kind, date: m.date ?? null, author: m.by,
  ...(m.of ? { of: m.of } : {}),
  body_sha256: createHash("sha256").update(m.body, "utf8").digest("hex"),
});

const git = (clone, ...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });

/** The frontmatter of a mark file, as the flat `key: value` lines its keys are; `body` is what follows the fence. */
export function parseMarkFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text));
  if (!m) return null;
  const get = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(m[1])?.[1] ?? "").trim();
  return { class: get("class"), kind: get("kind"), by: get("by"), date: get("date"), body: m[2].replace(/^\s+|\s+$/g, "") };
}

/**
 * Every standing idea mark at `ref` of a world clone, read through git so the clone's checkout (sparse, and
 * whatever branch it sits on) is not consulted: `[{ mark, by, kind, date, body, of?, path }]`, ordered by
 * path. The mark's id is `<by>/<its own slug>`, the id a stake on it is keyed by. The class mark is left out.
 * Writes nothing.
 */
export function readIdeaMarks({ worldClone, ref = "HEAD" }) {
  const listed = git(worldClone, "grep", "-l", "-E", "^class:[ \\t]*idea[ \\t]*$", ref, "--", "WORLD/marks").split("\n").filter(Boolean);
  const out = [];
  for (const line of listed.sort()) {
    const path = line.slice(line.indexOf(":") + 1);
    const f = parseMarkFile(git(worldClone, "show", `${ref}:${path}`));
    if (!f || f.class !== "idea" || (f.kind !== "sited" && f.kind !== "predicated")) continue;   // the class mark is kind: class
    const dirs = path.split("/").slice(2, -1);   // WORLD/marks/<dirs…>/mark.md
    const slug = dirs.at(-1);
    // A predicated idea is an idea ABOUT the mark it stands under: that parent's id is its own author and folder
    // (`<by of the parent's mark.md>/<the parent's folder>`), read from the parent's file. A parent this read cannot
    // find is named by its path, said so, never guessed.
    let of = null;
    if (f.kind === "predicated") {
      const parentDirs = dirs.slice(0, -1);
      const shown = spawnSync("git", ["-C", worldClone, "show", `${ref}:WORLD/marks/${parentDirs.join("/")}/mark.md`], { encoding: "utf8", maxBuffer: 1 << 24 });
      const parent = shown.status === 0 ? parseMarkFile(shown.stdout) : null;
      of = parent?.by ? `${parent.by}/${parentDirs.at(-1)}` : `path:${parentDirs.join("/")}`;
    }
    out.push({ mark: `${f.by}/${slug}`, by: f.by, kind: f.kind, date: f.date || null, body: f.body, path, ...(of ? { of } : {}) });
  }
  return out;
}

/**
 * The title an idea mark's post takes: the body's first clause (up to the first `: ; — . ! ?`, the record's own
 * convention for a claim's value, world.mjs § firstClauseOf) when it fits a title, else the body cut at a word
 * and ended with "…". It is never the slug and never the author's words rewritten: the body stands whole beside it.
 * One line, at most TITLE_MAX characters. Empty only when the body is.
 */
export function titleFor(m) {
  const text = String(m.body ?? "").replace(/\s+/g, " ").trim();
  const cut = text.search(/[:;—.!?]/);
  const clause = (cut === -1 ? text : text.slice(0, cut)).trim();
  if (clause && clause.length <= TITLE_MAX) return clause;
  const room = text.slice(0, TITLE_MAX - 1);
  const at = room.lastIndexOf(" ");
  return `${(at > TITLE_MAX / 2 ? room.slice(0, at) : room).trimEnd()}…`;
}

/**
 * The id the pen would mint for this title, offline: `<author>/<slug>`, then `-2`, `-3` while `held` has it.
 * `held` is every id a post or a mark holds, as a Set. The step asks the store itself and must agree.
 */
export function mintOffline(author, title, held) {
  const base = slugFromTitle(title);
  if (!base) return null;
  if (!held.has(`${author}/${base}`)) return `${author}/${base}`;
  for (let n = 2; n < 1000; n++) if (!held.has(`${author}/${base}-${n}`)) return `${author}/${base}-${n}`;
  return null;
}

/**
 * THE PLAN. Inputs, all read by the caller and none written here:
 *   marks      readIdeaMarks' rows
 *   posts      Map of an existing post's origin.mark → its id (a rerun finds its own posts), and
 *   heldIds    every id a post or a mark holds (the id mint refuses these)
 *   M          the office's pinned town grammar (stamp-mint); entries the ledger's entries
 *   isMeep     (handle, date) → bool: a meep's idea is the town's own and is not converted here
 * Returns `{ items, totals, proof, notices, problems }`. `items[i].state` is "new" (no post yet), "posted" (its
 * post exists) and, per ledger position, what remains to carry. A mark that cannot be represented losslessly
 * (a body over the limit, no title, an id that will not mint) is a `problems` row and is NOT planned: it stays
 * unwithdrawn for a person to resolve.
 */
export function planConversion({ marks, posts = new Map(), heldIds = new Set(), M, entries, date, isMeep = () => false }) {
  const positions = M.foldWorldMarkPositions(entries);
  const held = new Set(heldIds);
  const problems = [];
  const items = [];
  const seen = new Set();
  for (const m of marks) {
    const why = (reason) => problems.push({ mark: m.mark, by: m.by, reason });
    if (seen.has(m.mark)) { why(`two idea marks answer to ${m.mark}`); continue; }
    seen.add(m.mark);
    if (!m.by) { why("the mark names no author"); continue; }
    if (isMeep(m.by, date)) { why(`${m.by} is a meep: a meep's idea is not a resident's own work, and the town settles it by hand`); continue; }
    if (!m.body) { why("the mark has no body"); continue; }
    if (m.body.length > BODY_MAX) { why(`the body is ${m.body.length} characters and a post's is at most ${BODY_MAX}: not cut, not summarised`); continue; }
    const title = titleFor(m);
    if (!title) { why("no title can be drawn from the body"); continue; }
    let post = posts.get(m.mark) ?? null;
    const existing = post != null;
    if (!post) {
      post = mintOffline(m.by, title, held);
      if (!post) { why("no id mints for this title"); continue; }
      held.add(post);
    }
    const stakes = [];
    for (const [k, n] of positions) {
      const i = k.lastIndexOf("|");
      if (k.slice(0, i) === m.mark) stakes.push({ handle: k.slice(i + 1), n });
    }
    stakes.sort((a, b) => a.handle.localeCompare(b.handle));
    items.push({ mark: m.mark, by: m.by, kind: m.kind, date: m.date, ...(m.of ? { of: m.of } : {}), title, body: m.body, post,
      state: existing ? "posted" : "new", origin: originOf(m), stakes });
  }
  // the carry is planned over every item that still has a stake on its mark, as one conservative whole
  const carryItems = items.filter((i) => i.stakes.length).map((i) => ({ mark: i.mark, post: i.post }));
  let carry = { lines: [], moves: [], proof: null };
  if (carryItems.length) {
    try { carry = planCarry(M, entries, carryItems, { date, via: CONVERSION_VIA }); }
    catch (e) { problems.push({ mark: null, by: null, reason: `the carry is refused: ${e.defect ?? e.message} (${e.hint ?? ""})` }); }
  }
  const totals = {
    marks_read: marks.length,
    read_sited: marks.filter((m) => m.kind === "sited").length,
    read_predicated: marks.filter((m) => m.kind === "predicated").length,
    planned: items.length,
    already_posted: items.filter((i) => i.state === "posted").length,
    to_create: items.filter((i) => i.state === "new").length,
    unplanned: problems.length,
    marks_with_stakes: carryItems.length,
    stake_positions: carry.moves.length,
    stamps_carried: carry.moves.reduce((a, m) => a + m.n, 0),
    authors: new Set(items.map((i) => i.by)).size,
  };
  return { items, totals, proof: carry.proof, lines: carry.lines, notices: draftNotices(items), problems };
}

/** One notice per author, drafted and never sent: what became of their ideas, and that their stamps went with them. */
export function draftNotices(items) {
  const by = new Map();
  for (const i of items) by.set(i.by, [...(by.get(i.by) ?? []), i]);
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([to, mine]) => {
    const lines = mine.map((i) => {
      const staked = i.stakes.reduce((a, s) => a + s.n, 0);
      return `- "${i.title}" (it stood as ${i.mark}${i.date ? `, put up ${String(i.date).slice(0, 10)}` : ""}) is now your idea post ${i.post}.${staked ? ` The ✦${staked} staked behind it moved with it, each staker's part as it was.` : ""}`;
    });
    return { to, subject: mine.length === 1 ? "Your idea is now a post" : `Your ${mine.length} ideas are now posts`,
      body: [`The Think Tank's ideas are posts now, and an idea you put up as a mark is carried across to your own post, with where it came from kept on it (its mark id, its date, your words as you wrote them).`, "", ...lines, "",
        `Nothing is asked of you. The post is yours as the mark was: you may amend it, and anyone may stake it, sign up to build a part, or follow it. Its stamps are in the ledger as before.`].join("\n") };
  });
}

/** A stable digest of what a reviewer read: the apply refuses unless it recomputes the same one. */
export function manifestSha(plan, { ledgerHead = null, ref = null } = {}) {
  const core = { ledgerHead, ref, items: plan.items.map(({ mark, by, kind, date, of, title, post, stakes, origin }) => ({ mark, by, kind, date, of: of ?? null, title, post, stakes, body_sha256: origin.body_sha256 })), problems: plan.problems };
  return createHash("sha256").update(JSON.stringify(core), "utf8").digest("hex");
}
