// holder-tree.mjs — WHO HOLDS WHAT, AS A TREE: the walks up and down the
// holding record, each cycle-safe (plumb-nest-guard, 2026-10-17).
//
// The rows are attachment rows in `readAttachments` order, and the last row per
// thing decides who holds it (world-hold.mjs § liveHolder, the one rule). Every
// walk here goes the whole way and remembers where it has been, so a deep chain
// cannot outrun the loop check and a loop already in the rows ends the walk
// instead of hanging it.
//
// THE LAW (LOGOS/classes.md § The transfer edge; Darko, 2026-10-17 23:29: "yes,
// rule it, one holder and counts confer up"):
//
//   · between holders, a holder counts 1 plus everything it holds, recursively,
//     toward the room of whatever holds it: a bag holding 30 takes 31 places in
//     a chest of 120, and a give, take or make into a holder checks the room of
//     every holder above it, up to but not including a resident;
//   · in a resident's hands each thing counts 1, however full (the carry reads
//     stay one level: world-stacks.mjs § refuseOverCarry);
//   · a holder is never inside itself, however deep. No depth is set: the room
//     bounds it.

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

const isMarkId = (h) => typeof h === "string" && h.includes("/");

/** Each thing's live holder, in ONE pass over the rows (liveHolder's rule: the last row per thing decides). */
export function liveHolders(rows) {
  const last = new Map();
  for (const r of rows) last.set(String(r.target), r);
  const up = new Map();
  for (const [t, r] of last) if (r.policy === "cascade") up.set(t, String(r.entity));
  return up;
}

/** The holders above `id`, nearest first, to the top: `{ chain, loop }`, `loop` when the rows lead back on themselves. */
export function holderChain(up, id) {
  const chain = [], seen = new Set([String(id)]);
  for (let h = up.get(String(id)); h != null; h = up.get(h)) {
    if (seen.has(h)) return { chain, loop: true };
    seen.add(h);
    chain.push(h);
  }
  return { chain, loop: false };
}

/** The holders a count at `id` confers to: the marks above it, up to (not including) the first that is not a mark, a resident's hands. */
export function holdersAbove(up, id) {
  const { chain, loop } = holderChain(up, id);
  const stop = chain.findIndex((h) => !isMarkId(h));
  return { above: stop < 0 ? chain : chain.slice(0, stop), loop };
}

/**
 * Everything inside `holder` as its room counts it, past its own units: each
 * whole thing at any depth counts 1 plus its own units. `unitsOf(h)` is the
 * counted units `h` holds (world-stacks § totalOf over the fold). Each thing is
 * counted once, so a loop in the rows cannot run it forever.
 */
export function wholeLoadOf({ up, holder, unitsOf = () => 0 }) {
  const inside = new Map();
  for (const [t, h] of up) { if (!inside.has(h)) inside.set(h, []); inside.get(h).push(t); }
  const seen = new Set([String(holder)]);
  let load = 0;
  for (const stack = [String(holder)]; stack.length;) {
    for (const t of inside.get(stack.pop()) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      load += 1 + Number(unitsOf(t) ?? 0);
      stack.push(t);
    }
  }
  return load;
}

/** What a whole thing counts toward the room of a holder it goes into: 1, its own units, and everything inside it. */
export const weightOf = ({ up, thing, unitsOf = () => 0 }) => 1 + Number(unitsOf(String(thing)) ?? 0) + wholeLoadOf({ up, holder: thing, unitsOf });

/**
 * THE LOOP CHECK for a whole thing going into a holder: the kind door's and the
 * chest door's one home. Refuses the holder sitting inside the thing (however
 * deep), and a loop already in the rows above the holder.
 */
export function refuseNesting({ rows, up = liveHolders(rows), thing, into, noun = "holder", nothing = "Nothing was changed." }) {
  const { chain, loop } = holderChain(up, into);
  if (chain.includes(String(thing)))
    throw bounce(422, `${into} is inside ${thing}`, `a ${noun} cannot go inside what it is carried in. ${nothing}`);
  if (loop)
    throw bounce(422, `the record holds a loop above ${into}`, `its holders lead back to themselves, so where it sits cannot be told. ${nothing}`);
}
