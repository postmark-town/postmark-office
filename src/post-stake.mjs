// post-stake.mjs — THE STAKE ON AN IDEA POST, AT THE TOWN DOOR (POS-854).
//
// Darko, 2026-11-16 22:44 EST: "the idea, stakes carry over, exactly." Idea posts take stakes. The Think
// Tank's idea marks were stakeable (town-stake.mjs § STAKE_LANES); their posts are now too, so the one
// gesture, `town { do: "stake" }`, answers for a post id the way it answers for a mark id.
//
// ── ONE OWNER FOR ESCROW: THE LEDGER ────────────────────────────────────────
//
// A stake on a post is a line in the stamp ledger (`stake:post/<author>/<slug>`, the grammar POS-290 left
// inert for this day), written by post-stake-engine.mjs over the office's pinned town grammar, in the exec
// that holds the town lock (post-stake-exec.mjs). This file is the door's half: who is acting, is it an
// idea post that takes a stake, what would it do (preview), and the read. NOTHING HERE FOLDS A POSITION OF
// ITS OWN: the position is the ledger's, read by `postBackingOf`, which is also what every post row's
// `stake` and `ours` come from. A stake does not also write a `stake` response or act: two records of one
// position are two answers, and the one that can drift is the one that is not the ledger.
//
// WHAT THIS DOOR DOES NOT DO, said so it is not assumed: it offers no `against` side (the ledger's grammar
// has one; no ruling has opened it at a door), and it writes no `post-return` when an idea finishes (the
// grammar has the line; no ruling says who writes it or when). An unstake is always open, and clips to the
// staker's own position.

import { statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { officeRead } from "./world2-pen.mjs";
import { importTownTool } from "./town-tool.mjs";
import { runLockedExec } from "./town-lock.mjs";
import { actingAs, heldAtOffice } from "./world-stake.mjs";
import { clipTo, stampsBlock, toConfirm, NOTHING_MOVED } from "./stamps-preview.mjs";
import { IDEA_CLASS, IDEA_FINISHED, ideaPostsOn } from "./ideas.mjs";
import { ledgerEntriesOf, postStakeState } from "./post-stake-engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });
const townDay = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" });

/** The classes whose posts take a stake: idea today. (A bug takes none, bugs.mjs § NO STAKE; a ballot has its own stake.) */
export const STAKE_POST_CLASSES = Object.freeze([IDEA_CLASS]);

/** The rule a post stake is consented to under, quoted in the preview in the mark rule's shape. */
export const RULE_POST = Object.freeze({
  mark: "the-town/stake",
  says: "A stake is ✦ held in escrow behind a post — belief with weight, standing until taken back, and the record keeps both the placing and the withdrawal. It is yours the whole time: an unstake brings it home whole.",
});

/** An idea post's row by id, or null: `{ id, class, state }`. A store that cannot be read throws. */
export async function postRowFor(id, { env = process.env } = {}) {
  return officeRead(async (client) => {
    const { rows } = await client.query("SELECT id, class, state FROM posts WHERE id = $1", [String(id)]);
    return rows[0] ?? null;
  }, { env, by: "postStakeRow" });
}

/**
 * Is `id` a post this door stakes? `{ post }` for one standing; `null` when it is not a post at all (the
 * caller then says what it said before); or a bounce naming the fact. A store that cannot be read is a
 * bounce saying so, never "no such post".
 */
export async function judgePostTarget(id, { env = process.env, row = postRowFor, forUnstake = false } = {}) {
  // While the idea class is closed there is no idea post to back: off means today's marks, unchanged, and the posts are not asked.
  if (!ideaPostsOn(env)) return null;
  let found;
  try { found = await row(id, { env }); }
  catch { return { refused: bounce(503, "the posts live in the office's record, and it could not be read", "nothing was staked and your stamps are untouched — try again shortly") }; }
  if (!found) return null;
  if (!STAKE_POST_CLASSES.includes(String(found.class)))
    return { refused: bounce(422, `"${id}" is a ${found.class} post, and a ${found.class} takes no stake here`,
      `a stake backs an idea: town { read: "posts", args: { class: "idea", sort: "staked" } } lists the ideas by what stands behind them`, { class: found.class }) };
  if (!forUnstake && IDEA_FINISHED.includes(found.state))
    return { refused: bounce(409, `"${id}" is finished (${found.state}) and takes no new stake`,
      "a stake backs an idea still open; if you hold stamps on this one, town { do: \"unstake\" } brings them home") };
  return { post: found };
}

async function stakeEngine(clone) {
  return importTownTool(clone, "stamp-mint.mjs");
}

/** The ledger's post positions, folded once per ledger state (the file's mtime and size), for every row that asks. */
let backingCache = null;
export async function postBackingOf(townClone = TOWN_CLONE()) {
  const ledger = join(townClone, "WHITE_PAGES", "stamp-ledger.md");
  let stamp = "absent";
  try { const st = statSync(ledger); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* an absent ledger reads as empty */ }
  const key = `${townClone}|${stamp}`;
  if (backingCache?.key === key) return backingCache.value;
  const M = await stakeEngine(townClone);
  const state = postStakeState(M, ledgerEntriesOf(M, townClone));
  const holders = new Map();
  for (const [k, v] of state.positions) {
    const i = k.lastIndexOf("|");
    const post = k.slice(0, i);
    holders.set(post, [...(holders.get(post) ?? []), { handle: k.slice(i + 1), n: v.n, side: v.side }]);
  }
  const value = { escrow: state.escrow, holders, state };
  backingCache = { key, value };
  return value;
}

/** `town { do: "stake" }` on an idea post. Null when `args.mark` is not a post (the mark door answers). */
export async function stakePostViaOffice(args = {}, key = null, deps = {}) {
  const { env = process.env, judge = judgePostTarget, held = heldAtOffice, ledger = null, clone = TOWN_CLONE() } = deps;
  const target = await judge(args.mark, { env });
  if (!target) return null;
  if (target.refused) return target.refused;
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  const n = Number(args.stamps);
  if (!Number.isInteger(n) || n < 1) return bounce(422, "how many stamps?", "pass stamps: a whole number of at least 1 — a post takes a stake of at least ✦1");
  if (args.preview === true) {
    const now = await held(who.handle);
    const { moves } = clipTo(n, Number(now.liquid ?? 0));
    return { preview: true, post: args.mark, handle: who.handle,
      stamps: stampsBlock({ held: now, moves, requested: n, direction: "stake", rule: RULE_POST,
        to_confirm: toConfirm(`town { do: "stake", args: { mark: "${args.mark}", stamps: ${n} } }`) }),
      nothing_written: NOTHING_MOVED };
  }
  const before = await held(who.handle);
  let out;
  try {
    out = ledger ? await ledger({ verb: "stake", handle: who.handle, post: args.mark, n, date: townDay() })
      : await runLockedExec(join(HERE, "post-stake-exec.mjs"), { verb: "stake", handle: who.handle, post: args.mark, n, date: townDay() },
        { clone, tripped: "the stake could not be recorded" });
  } catch (e) {
    return bounce(e.code ?? 500, e.defect ?? "the stake could not be recorded", e.hint ?? "nothing was staked and your stamps are untouched — try again");
  }
  if (out?.error) return out.error?.code ? { error: "bounce", ...out.error } : out;
  return { ...out, stamps: stampsBlock({ held: before, moves: Number(out?.applied ?? 0), requested: n, direction: "stake", rule: RULE_POST,
    ...(out?.reason ? { reason: out.reason } : {}) }) };
}

/** `town { do: "unstake" }` on an idea post, always open to the staker. Null when `args.mark` is not a post. */
export async function unstakePostViaOffice(args = {}, key = null, deps = {}) {
  const { env = process.env, judge = judgePostTarget, held = heldAtOffice, ledger = null, clone = TOWN_CLONE() } = deps;
  const target = await judge(args.mark, { env, forUnstake: true });
  if (!target) return null;
  if (target.refused) return target.refused;
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  const n = Number(args.stamps);
  if (!Number.isInteger(n) || n < 1) return bounce(422, "how many stamps?", "pass stamps: a whole number of at least 1");
  if (args.preview === true) {
    const now = await held(who.handle);
    let open = 0;
    try { open = (await postBackingOf(clone)).state.positions.get(`${args.mark}|${who.handle}`)?.n ?? 0; }
    catch { return { preview: true, post: args.mark, handle: who.handle, unread: "the ledger could not be read, so your open position on this post could not be previewed", nothing_written: NOTHING_MOVED }; }
    const { moves } = clipTo(n, open);
    return { preview: true, post: args.mark, handle: who.handle, position: open,
      stamps: stampsBlock({ held: now, moves, requested: n, direction: "unstake", rule: RULE_POST,
        to_confirm: toConfirm(`town { do: "unstake", args: { mark: "${args.mark}", stamps: ${n} } }`) }),
      nothing_written: NOTHING_MOVED };
  }
  const before = await held(who.handle);
  let out;
  try {
    out = ledger ? await ledger({ verb: "unstake", handle: who.handle, post: args.mark, n, date: townDay() })
      : await runLockedExec(join(HERE, "post-stake-exec.mjs"), { verb: "unstake", handle: who.handle, post: args.mark, n, date: townDay() },
        { clone, tripped: "the unstake could not be recorded" });
  } catch (e) {
    return bounce(e.code ?? 500, e.defect ?? "the unstake could not be recorded", e.hint ?? "nothing moved and your stake stands — try again");
  }
  if (out?.error) return out.error?.code ? { error: "bounce", ...out.error } : out;
  return { ...out, stamps: stampsBlock({ held: before, moves: Number(out?.applied ?? 0), requested: n, direction: "unstake", rule: RULE_POST,
    ...(out?.reason ? { reason: out.reason } : {}) }) };
}

/** `town { read: "stake" }` on an idea post: the escrow behind it and who holds it. Null when `args.mark` is not a post. */
export async function postStakeRead(args = {}, deps = {}) {
  const { env = process.env, judge = judgePostTarget, clone = TOWN_CLONE() } = deps;
  const target = await judge(args.mark, { env, forUnstake: true });
  if (!target) return null;
  if (target.refused) return target.refused;
  let backing;
  try { backing = await postBackingOf(clone); }
  catch { return bounce(503, "the ledger could not be read", "nothing is wrong with your call — ask again shortly"); }
  const holders = (backing.holders.get(args.mark) ?? []).sort((a, b) => b.n - a.n || a.handle.localeCompare(b.handle))
    .map((h) => ({ handle: h.handle, stamps: h.n }));
  const escrow = backing.escrow.get(args.mark) ?? 0;
  return { post: args.mark, class: IDEA_CLASS, escrow, stamps: escrow, holders,
    _note: "a post's escrow is the stamps standing behind it in the ledger, as the ledger folds them; it is not a ✦weight, which belongs to marks" };
}
