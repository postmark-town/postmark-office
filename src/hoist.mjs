// hoist.mjs — what the town-wide pieces of a doorstep share (POS-1086).
//
// The site's refresh asks for every resident's doorstep in one pass, and each doorstep is composed at the same town head and
// the same world. A piece that does not depend on the resident is computed ONCE per key and every doorstep in the pass
// reuses it. A hoist here is always: one kept value, keyed on a print that covers every input the value reads; at most one
// entry (a new key drops the old); and a value handed out FROZEN, so no caller can change what the next caller is given.

/** `v` and everything under it, frozen. Only plain data (objects, arrays, scalars) goes through here. */
export function deepFreeze(v) {
  if (v === null || typeof v !== "object" || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

/** Two arrays of the same strict-equal scalars? */
export function sameScalars(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
