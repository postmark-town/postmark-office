// terms-seen.mjs — THE LAW YOU WERE SHOWN, REMEMBERED (POS-697 G5a).
//
// Darko, 2026-10-19 09:21, option (c): every act's answer carried its `terms`
// whole (1,884 characters for a walk on prod), the same block again on every
// say and walk. "You cannot be bound by law you were not shown at the door"
// stays the rule: the FIRST act under a body of law shows it whole, and a
// repeat act under the very same law names it (the granting class and its
// version, the meaning's class, an id that pins the exact text) and says
// where it is whole. Any change to the law changes its id, and it is shown
// whole again.
//
// FAIL-SAFE TOWARD THE WHOLE LAW. The memory is this process's RAM, per
// standpoint, for this crossing and the last. A restart, a second process or
// an evicted entry forgets, and forgetting only ever means the terms are
// shown whole again; nothing here can make a resident miss law they have not
// seen. It is scoped to v2 callers (read_shape: "v2"); everyone else gets
// the whole block, as before.
//
// What the id covers: the settled law only (binds, means, carriage,
// articles). `quoted` is resident prose on the spine, not law, and changes as
// you move, so it does not count (ruled with option c).

import { createHash } from "node:crypto";

/** How long a showing is remembered: this crossing and the last. */
export const SEEN_FOR_MS = 24 * 3600_000;
/** How many bodies of law are remembered per standpoint; the oldest is forgotten first. */
export const SEEN_CAP = 64;

/** The id of a terms block's settled law: `t1.` and twelve hex of its hash. */
export function termsId(terms) {
  const law = { binds: terms?.binds ?? null, means: terms?.means ?? null, carriage: terms?.carriage ?? null, articles: terms?.articles ?? null };
  return `t1.${createHash("sha256").update(JSON.stringify(law)).digest("hex").slice(0, 12)}`;
}

const shown = new Map(); // standpoint → Map(id → ms shown)

/** The repeat form: the law named, pinned by its id, and where it is whole. */
export function namedTerms(terms, action) {
  return {
    seen: true,
    id: terms.id,
    binds: { from: terms.binds?.from ?? null, version: terms.binds?.version ?? null },
    ...(terms.means?.from ? { means: terms.means.from } : {}),
    whole: `world { read: "${action}" }`,
    note: "the same law you were shown whole on an earlier act; any change to it changes its id, and it is shown whole again",
  };
}

/**
 * The terms an act's answer carries for `who`: whole the first time this law
 * is shown to them (remembered as shown), named after that. `who` null, or a
 * block with no id, is always whole.
 */
export function termsOnce(who, terms, action, { nowMs = Date.now() } = {}) {
  if (!who || !terms?.id) return terms;
  const mine = shown.get(who) ?? new Map();
  for (const [id, at] of mine) if (nowMs - at > SEEN_FOR_MS) mine.delete(id);
  if (mine.has(terms.id)) return namedTerms(terms, action);
  mine.set(terms.id, nowMs);
  while (mine.size > SEEN_CAP) mine.delete(mine.keys().next().value);
  shown.set(who, mine);
  return terms;
}

/** Forget every showing (a test seam; a restart does the same). */
export function forgetShown() { shown.clear(); }
