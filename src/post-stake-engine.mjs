// post-stake-engine.mjs — THE STAKE ON AN IDEA POST: its positions, its clip, its carry (POS-854).
//
// Darko, 2026-11-16 22:44 EST: "Oh, yeah, no consent chase. And the idea, stakes carry over, exactly."
//
// ── ONE OWNER FOR ESCROW, AND IT IS STILL THE LEDGER ────────────────────────
//
// The town's stamp ledger already speaks the post stake (POS-290, "inert until
// the office writes them"): `<handle> → stake:post/<author>/<slug> · n · side:
// for · via: <channel>`, its unstake, and the finished post's return. The town's
// verifier enforces it (ownership of a position, one side, a whole return).
// What the town does not have is an engine that APPLIES one the way
// world-stake.mjs applies a mark's: the clip to the staker's balance, the clip
// of an unstake to the staker's own position, the signed append. This file is
// that engine, in the office, over the office's PINNED copy of the town's
// grammar (`M` below is `importTownTool(clone, "stamp-mint.mjs")`), so it adds
// no second grammar: every line it writes is one `postStakeLine`,
// `postUnstakeLine` or `worldUnstakeLine` made.
//
// It is pure over `M` and a repo path: no store, no lock, no commit. The exec
// (post-stake-exec.mjs) is what holds the lock and lands the commit.
//
// ── THE CARRY (the conversion's money half) ─────────────────────────────────
//
// A standing idea mark's escrow moves to its post as lines the ledger already
// has: for each staker, one `world-unstake` out of the mark and one `post-stake`
// into the post, the SAME n, appended in ONE signed append so nothing is
// liquid between them. Nothing is minted, nothing burns: `planCarry` folds the
// ledger before and after and returns both sides, and refuses (throws) unless
// every handle's liquid balance and the whole of what is staked are equal.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The channel a conversion's lines name. One token, no "·" (the grammar's rule). */
export const CONVERSION_VIA = "conversion";
/** The channel a door's stake names, as the mark door's does. */
export const DOOR_VIA = "api";

export const bounce = (code, defect, hint) => {
  const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e;
};

/** The ledger's entries, `[{ canonical, sig, raw }]`, or `[]` for a clone with none. */
export function ledgerEntriesOf(M, clone) {
  const path = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  return existsSync(path) ? M.parseStampLedger(readFileSync(path, "utf8")) : [];
}

/**
 * Every post's open stakes, folded from the entries: `escrow` (post → n) and
 * `positions` (`${post}|${handle}` → { n, side }). A post absent from either has
 * none: zero has one representation. A return empties its position, as the
 * verifier's own fold does.
 */
export function postStakeState(M, entries) {
  const positions = new Map();
  const escrow = new Map();
  const set = (post, handle, side, delta) => {
    const k = `${post}|${handle}`;
    const open = positions.get(k) ?? { n: 0, side: null };
    positions.set(k, { n: open.n + delta, side: side ?? open.side });
    escrow.set(post, (escrow.get(post) ?? 0) + delta);
  };
  for (const e of entries) {
    const c = M.classifyEntry(e.canonical);
    if (c.kind === "post-stake") set(c.post, c.handle, c.side, c.n);
    else if (c.kind === "post-unstake" || c.kind === "post-return") set(c.post, c.handle, null, -c.n);
  }
  for (const [k, v] of positions) if (v.n === 0) positions.delete(k);
  for (const [k, v] of escrow) if (v === 0) escrow.delete(k);
  return { escrow, positions };
}

/** Who holds what on one post: `[{ handle, n, side }]`, largest first. */
export function holdersOf(state, post) {
  const out = [];
  for (const [k, v] of state.positions) {
    const i = k.lastIndexOf("|");
    if (k.slice(0, i) === post) out.push({ handle: k.slice(i + 1), n: v.n, side: v.side });
  }
  return out.sort((a, b) => b.n - a.n || a.handle.localeCompare(b.handle));
}

const lawAtOf = (M, entries) => {
  const { laws } = M.parseLaws(entries);
  return (date) => {
    let active = { rules: "stamps-v1", meeps: new Set() };
    for (const l of laws) if (l.date <= date) active = l;
    return active;
  };
};

const wholeStamps = (n, verb) => {
  const x = Number(n);
  if (!Number.isInteger(x) || x < 1) throw bounce(422, "stamps must be a whole number of at least 1", `${verb} whole stamps`);
  return x;
};

/**
 * A stake on a post: clipped to the staker's liquid balance, appended signed.
 * `applied: 0` with a reason is an honest answer; only malformed input throws.
 */
export function postStakeApply(M, clone, { handle, post, n, via = DOOR_VIA, date }, keyPem) {
  if (!handle || !post || !date) throw bounce(422, "incomplete stake", "required: handle, post, n, date");
  n = wholeStamps(n, "stakes move");
  const entries = ledgerEntriesOf(M, clone);
  if (lawAtOf(M, entries)(date).meeps.has(handle))
    throw bounce(403, `meep accounts cannot stake (${handle})`, "stamps-v2 law: meeps neither mint nor stake");
  const state = postStakeState(M, entries);
  const open = state.positions.get(`${post}|${handle}`) ?? { n: 0, side: null };
  if (open.n > 0 && open.side !== "for")
    throw bounce(409, `${handle} stands against "${post}" and a position has one side`, "take that stake back first, then stake again");
  const balance = M.foldBalances(entries).get(handle) ?? 0;
  const applied = Math.min(n, balance);
  const result = { post, handle, requested: n, applied, clipped: applied < n, balance_before: balance,
    post_escrow_before: state.escrow.get(post) ?? 0, position_before: open.n };
  if (applied <= 0) {
    return { ...result, reason: "your balance has no stamps free to stake", post_escrow_after: result.post_escrow_before };
  }
  const line = M.postStakeLine({ date, handle, post, n: applied, side: "for", via });
  M.appendSigned(clone, [line], keyPem);
  return { ...result, balance_after: balance - applied, post_escrow_after: result.post_escrow_before + applied, position_after: open.n + applied };
}

/** The staker's own way out, clipped to their own open position on the post. */
export function postUnstakeApply(M, clone, { handle, post, n, via = DOOR_VIA, date }, keyPem) {
  if (!handle || !post || !date) throw bounce(422, "incomplete unstake", "required: handle, post, n, date");
  n = wholeStamps(n, "unstakes move");
  const entries = ledgerEntriesOf(M, clone);
  const state = postStakeState(M, entries);
  const open = state.positions.get(`${post}|${handle}`)?.n ?? 0;
  const applied = Math.min(n, open);
  const result = { post, handle, requested: n, applied, clipped: applied < n, position_before: open,
    post_escrow_before: state.escrow.get(post) ?? 0 };
  if (applied <= 0) return { ...result, reason: `you have no stamps staked on ${post}`, post_escrow_after: result.post_escrow_before };
  M.appendSigned(clone, [M.postUnstakeLine({ date, post, handle, n: applied, via })], keyPem);
  return { ...result, position_after: open - applied, post_escrow_after: result.post_escrow_before - applied };
}

/** Σ of every account's balance that is a stake account, by prefix: what the town holds in escrow. */
const stakedTotal = (bal, prefix) => [...bal].filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v, 0);

/**
 * THE CARRY'S PLAN: for each `{ mark, post }`, every open world-mark position on
 * the mark becomes an unstake from the mark and a stake on the post, the same n,
 * one pair per staker. Returns the canonical lines (not yet signed), the moves,
 * and the proof: each handle's liquid balance before and after, and the whole
 * staked before and after. THROWS when either side differs: a plan that is not
 * conservative is never returned.
 *
 * `expect` (optional) maps `${mark}|${handle}` → n from a reviewed manifest: a
 * position that is not exactly what the manifest recorded refuses the plan (the
 * source moved since it was read).
 */
export function planCarry(M, entries, items, { date, via = CONVERSION_VIA, expect = null } = {}) {
  const positions = M.foldWorldMarkPositions(entries);
  const state = postStakeState(M, entries);
  const lines = [];
  const moves = [];
  const lawAt = lawAtOf(M, entries);
  for (const { mark, post } of items) {
    const held = [];
    for (const [k, n] of positions) {
      const i = k.lastIndexOf("|");
      if (k.slice(0, i) === mark) held.push({ handle: k.slice(i + 1), n });
    }
    held.sort((a, b) => a.handle.localeCompare(b.handle));
    if (expect) {
      const want = [...expect].filter(([k]) => k.startsWith(`${mark}|`));
      const got = new Map(held.map((h) => [`${mark}|${h.handle}`, h.n]));
      for (const [k, n] of want) if (got.get(k) !== n)
        throw bounce(409, `the stakes on ${mark} are not what the manifest read (${k}: manifest ${n}, ledger ${got.get(k) ?? 0})`, "the ledger moved since the dry run: run the dry run again and review it");
      for (const [k] of got) if (!expect.has(k))
        throw bounce(409, `${k} holds stamps on ${mark} that the manifest does not list`, "the ledger moved since the dry run: run the dry run again and review it");
    }
    for (const h of held) {
      if (lawAt(date).meeps.has(h.handle)) throw bounce(403, `${h.handle} is a meep and a post takes no meep's stake`, "a meep's position on a mark is the town's to settle by hand");
      const there = state.positions.get(`${post}|${h.handle}`);
      if (there && there.side !== "for") throw bounce(409, `${h.handle} stands against "${post}" already`, "a position has one side");
      lines.push(M.worldUnstakeLine({ date, mark, handle: h.handle, n: h.n }));
      lines.push(M.postStakeLine({ date, handle: h.handle, post, n: h.n, side: "for", via }));
      moves.push({ mark, post, handle: h.handle, n: h.n });
    }
  }
  const before = M.foldBalances(entries);
  const after = M.foldBalances([...entries, ...lines.map((canonical) => ({ canonical }))]);
  const handles = new Set(moves.map((m) => m.handle));
  const liquid = [...handles].sort().map((h) => ({ handle: h, before: before.get(h) ?? 0, after: after.get(h) ?? 0 }));
  const proof = {
    liquid,
    staked_before: { marks: stakedTotal(before, "stake:world-mark/"), posts: stakedTotal(before, "stake:post/") },
    staked_after: { marks: stakedTotal(after, "stake:world-mark/"), posts: stakedTotal(after, "stake:post/") },
    carried: moves.reduce((a, m) => a + m.n, 0),
  };
  const sumBefore = proof.staked_before.marks + proof.staked_before.posts;
  const sumAfter = proof.staked_after.marks + proof.staked_after.posts;
  if (liquid.some((l) => l.before !== l.after) || sumBefore !== sumAfter)
    throw bounce(500, "the carry would not be conservative, so it is not planned",
      `liquid ${JSON.stringify(liquid.filter((l) => l.before !== l.after))}; staked before ${sumBefore}, after ${sumAfter}`);
  if (proof.staked_after.posts - proof.staked_before.posts !== proof.carried || proof.staked_before.marks - proof.staked_after.marks !== proof.carried)
    throw bounce(500, "the carry's two legs differ", `carried ${proof.carried}; marks ${proof.staked_before.marks} -> ${proof.staked_after.marks}; posts ${proof.staked_before.posts} -> ${proof.staked_after.posts}`);
  return { lines, moves, proof };
}

/** The carry, appended signed in ONE append, or nothing. */
export function carryApply(M, clone, items, { date, via = CONVERSION_VIA, expect = null }, keyPem) {
  const entries = ledgerEntriesOf(M, clone);
  const plan = planCarry(M, entries, items, { date, via, expect });
  if (!plan.lines.length) return { ...plan, appended: 0 };
  M.appendSigned(clone, plan.lines, keyPem);
  return { ...plan, appended: plan.lines.length };
}
