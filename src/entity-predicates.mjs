// entity-predicates.mjs — what a resident looks like: a tree of predicates on
// the resident itself, canon live (WLD-83; Darko 2026-10-19 18:59, 19:04, 19:42).
//
// THE LAW (postmark-world LOGOS, classes.md § The appearance class):
//
//   · A predicate's parent may be an ENTITY. The root of a resident's tree is
//     `parent: resident:<handle>`, and every node under it is a predicate on the
//     node above (the continuation law). It takes the resident's locus, carries
//     no geometry and is never drawn.
//   · One shape, the predicate's own: a slot, a value and a body. The root's
//     slot is `appearance` and its body is THE GLANCE; the details' slots are the
//     author's own words. The only cap is the global one every mark has, a body
//     of at most 150 characters ("I would much rather enforce a global predicate
//     level cap than have differing caps for different types"). No tree maximum.
//   · The resident's own household writes it (P1, the default). "An act is
//     sovereign because its author is" (tiers.md § The two apexes), so nothing
//     can rival it and it is CANON THE MOMENT IT LANDS (`canon: live`): there
//     is no draft, no window and no sweep.
//   · Kept in the store's log of acts (P3), class `appearance`: `describe`
//     writes or revises a node (the latest appended wins), `withdraw` takes a
//     node and everything under it. `acts` is published by the notary, which is
//     the public record. It is never filed in WORLD/marks.
//   · A close look descends (P10): the node, its own predicates, and with
//     `depth` the levels below under one cap on bodies, through the engine's
//     `descend` (world-verbs.mjs), the same descent `investigate` gives a mark.
//
// THE IDS ARE THE PATH. The root is `<handle>/appearance` and a detail is its
// parent's id, a dot, and its slot (`<handle>/appearance.hood.clasp`). So one
// slot under one parent is one node (a second describe revises it, which is a
// predicate's rivalry key, (parent, slot), with one author), a node's subtree
// is every id it prefixes, and a withdraw needs no second table to find it.
//
// THE FOLD. Every process keeps the nodes in RAM: one catch-up query on the
// acts' class index (at most once a second, coalesced), plus its own writes at
// once. A read on the writing office sees a describe immediately; another
// process sees it within a second.

export const APPEARANCE_CLASS = "appearance";
export const ACTION_DESCRIBE = "describe";
export const ACTION_WITHDRAW = "withdraw";
export const ROOT_SLOT = "appearance";
// The global cap (postmark-world tools/mark-lint.mjs BODY_MAX; office world.mjs's
// leave-mark door): a body of at most 150 characters, whatever the mark.
export const BODY_MAX = 150;
// A slot is a word: lowercase, digits and hyphens, the same grammar a slug has.
const SLOT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HANDLE = /^[a-z0-9][a-z0-9-]*$/;
const NODE_ID = /^([a-z0-9][a-z0-9-]*)\/appearance((?:\.[a-z0-9][a-z0-9-]*)*)$/;
const CATCH_UP_MS = 1000;

export const rootIdOf = (handle) => `${handle}/${ROOT_SLOT}`;

/** `{ handle, id }` when `value` names a node of an appearance tree, else null. */
export function appearanceIdOf(value) {
  const m = NODE_ID.exec(String(value ?? "").trim());
  return m ? { handle: m[1], id: m[0] } : null;
}

export const FOLD_SQL = `SELECT id::text AS id, at, actor, action, object, payload FROM acts
  WHERE class = '${APPEARANCE_CLASS}' AND id > $1::bigint ORDER BY id LIMIT 5000`;

const fold = { cursor: 0n, nodes: new Map(), at: 0, inflight: null };

/** Tests only: forget every node and the cursor. */
export function __resetAppearanceForTest() {
  fold.cursor = 0n; fold.nodes = new Map(); fold.at = 0; fold.inflight = null;
}

const asObject = (p) => (typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return null; } })() : p);

/** Apply one act row to a node map (pure over the map; the fold and the tests share it). */
export function applyAct(nodes, row) {
  const id = String(row.object ?? "");
  if (!appearanceIdOf(id)) return nodes;
  if (row.action === ACTION_WITHDRAW) {
    for (const k of [...nodes.keys()]) if (k === id || k.startsWith(`${id}.`)) nodes.delete(k);
    return nodes;
  }
  if (row.action !== ACTION_DESCRIBE) return nodes;
  const p = asObject(row.payload) ?? {};
  nodes.set(id, { id, parent: p.parent, slot: p.slot, value: p.value, body: p.body, by: row.actor, act: String(row.id), at: row.at });
  return nodes;
}

// false when the office keeps no record at all (no store configured): there is
// then no appearance to read, which is a state, not a fault worth a log line
async function catchUp(query) {
  for (;;) {
    const rows = await query(FOLD_SQL, [fold.cursor.toString()]);
    if (rows == null) return false;
    for (const r of rows) {
      applyAct(fold.nodes, r);
      const id = BigInt(r.id);
      if (id > fold.cursor) fold.cursor = id;
    }
    if (rows.length < 5000) break;
  }
  fold.at = Date.now();
  return true;
}

/**
 * Every appearance node this office knows, as of at most a second ago and
 * every write it made itself. Null when the record cannot be read.
 */
export async function appearanceNodes({ query = null, now = Date.now() } = {}) {
  if (now - fold.at < CATCH_UP_MS && fold.at) return fold.nodes;
  const q = query ?? (await import("./world2-acts.mjs")).actsQuery;
  fold.inflight ??= catchUp(q).finally(() => { fold.inflight = null; });
  let kept;
  try { kept = await fold.inflight; } catch (e) { console.error(`[appearance] the fold could not be read: ${e?.message ?? e}`); return null; }
  return kept ? fold.nodes : null;
}

/** A node's own predicates, in slot order. */
function predicatesOf(nodes, id) {
  const out = [];
  for (const n of nodes.values()) if (n.parent === id) out.push(n);
  return out.sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
}

const row = (n) => ({ id: n.id, slot: n.slot, value: n.value, body: n.body });

/**
 * The close look at one node, in investigate's own shape: the node, its own
 * predicates (at most `budget`), `more` for what that cut, and with `depth`
 * past 1 the levels below (`beneath`, `descend`) through the engine's one
 * descent. `descend` is the engine's function; when the engine this office runs
 * is older than it, the look stays one level deep and says so.
 */
export function nodeAnswer(nodes, id, { depth = 1, budget = 12, descend = null } = {}) {
  const n = nodes.get(id);
  if (!n) return null;
  const all = predicatesOf(nodes, id);
  const predicates = all.slice(0, budget).map(row);
  const out = { id: n.id, slot: n.slot, value: n.value, body: n.body, parent: n.parent, predicates,
    more: { predicates: all.length - predicates.length } };
  if (!(depth > 1)) return out;
  if (typeof descend !== "function")
    return { ...out, beneath_unavailable: "this office's engine predates the descent; investigate a detail by its id to go deeper" };
  const d = descend(predicates.map((p) => p.id), (pid) => predicatesOf(nodes, pid).map(row), { depth, budget });
  return { ...out, more: { ...out.more, beneath: d.cut }, beneath: d.rows, descend: d.descend };
}

/** A resident's appearance as a close look gives it: the root node's answer, or null when none is set. */
export async function appearanceFor(handle, { depth = 1, budget, descend = null, query = null } = {}) {
  const nodes = await appearanceNodes({ query });
  if (!nodes) return { unavailable: "the appearance could not be read from the record just now" };
  return nodeAnswer(nodes, rootIdOf(handle), { depth, budget, descend });
}

const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

/**
 * THE DOOR: `world { do: "describe", args: { slot, value, body, under? } }`,
 * or `args: { withdraw: "<id>" }`. A resident describes ITSELF: the root is
 * `slot: "appearance"` (its body is the glance), and a detail names the node it
 * hangs `under` (the root when left out). Canon at once.
 *
 * `deps` are the door's own seams, so the tests drive the real door: `write`
 * (the acts pen), `nodes` (the fold) and `now`.
 */
export async function worldDescribe(args = {}, key = null, deps = {}) {
  const handles = [...(key?.handles ?? [])];
  const named = String(args.handle ?? "").trim();
  const handle = named || (handles.length === 1 ? handles[0] : "");
  if (!handle)
    throw bounce(422, "which resident are you describing?",
      handles.length ? `this key acts for ${handles.length} residents — pass handle: one of ${handles.join(", ")}` : "no residents on this key — sign in, or use a household key",
      { choices: handles });
  if (!HANDLE.test(handle) || !key?.handles?.has(handle))
    throw bounce(403, `"${handle}" is not one of your residents`,
      "a resident's appearance is written by its own household (WLD-83 P1); describe one of your own: " + (handles.join(", ") || "(none on this key)"));
  const household = String(key?.household ?? "").trim();
  if (!household) throw bounce(403, "this credential has no resident household", "sign in as a resident household to describe a resident");

  const nodes = await (deps.nodes ?? (() => appearanceNodes()))();
  if (!nodes) throw bounce(503, "the office's record cannot be reached — nothing was written, and nothing was lost", "try again shortly");
  const root = rootIdOf(handle);
  const write = deps.write ?? defaultWrite;

  if (args.withdraw != null && String(args.withdraw).trim() !== "") {
    const id = String(args.withdraw).trim();
    const at = appearanceIdOf(id);
    if (!at || at.handle !== handle)
      throw bounce(403, `"${id}" is not a node of ${handle}'s appearance`, `${handle}'s nodes are ${root} and the ids under it; read them with world { investigate: "${handle}" }`);
    if (!nodes.has(id)) throw bounce(404, `no node "${id}"`, `world { investigate: "${handle}" } lists what stands`);
    const actId = await write({ actor: handle, action: ACTION_WITHDRAW, object: id, payload: { withdrawn: true }, household });
    applyAct(nodes, { id: actId, action: ACTION_WITHDRAW, object: id, actor: handle });
    return { withdrawn: id, act: actId, canon: "live: gone for everyone now, with everything under it",
      appearance: nodeAnswer(nodes, root) };
  }

  const slot = String(args.slot ?? "").trim();
  if (!SLOT.test(slot))
    throw bounce(422, "a detail needs a slot: one word, lowercase, digits and hyphens", `the glance is slot: "${ROOT_SLOT}"; a detail names what it describes in your own words, e.g. slot: "hood"`);
  const value = typeof args.value === "string" ? args.value.trim() : "";
  if (!value) throw bounce(422, "a predicate needs a value", "what the slot is, in a word or a phrase: slot: \"hood\", value: \"grey wool\"");
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!body) throw bounce(422, "a predicate needs a body", `one present-tense sentence, at most ${BODY_MAX} characters — for the root, the glance others see`);
  const bodyLength = [...body].length;
  if (bodyLength > BODY_MAX)
    throw bounce(422, `body is ${bodyLength} chars; the cap is ${BODY_MAX}`, "the one cap every mark and predicate has; say the rest as a detail under this one");

  let parent, id;
  const under = args.under == null ? "" : String(args.under).trim();
  if (slot === ROOT_SLOT) {
    if (under) throw bounce(422, `slot "${ROOT_SLOT}" is the root, and the root hangs on the resident itself`, `leave out under: for the glance; a detail under it takes its own slot`);
    parent = `resident:${handle}`; id = root;
  } else {
    const on = under || root;
    const at = appearanceIdOf(on);
    if (!at || at.handle !== handle)
      throw bounce(403, `"${on}" is not a node of ${handle}'s appearance`, `a detail hangs under ${root} or a node below it`);
    if (!nodes.has(on))
      throw bounce(422, on === root ? `${handle} has no appearance yet` : `no node "${on}"`,
        on === root ? `describe the glance first: slot: "${ROOT_SLOT}", value: …, body: "what others see, in at most ${BODY_MAX} characters"` : `world { investigate: "${handle}" } lists what stands`);
    parent = on; id = `${on}.${slot}`;
  }
  const revised = nodes.has(id);
  const payload = { parent, slot, value, body };
  const actId = await write({ actor: handle, action: ACTION_DESCRIBE, object: id, payload, household });
  applyAct(nodes, { id: actId, action: ACTION_DESCRIBE, object: id, actor: handle, payload, at: new Date(deps.now ?? Date.now()).toISOString() });
  return {
    described: id, revised, act: actId,
    canon: "live: everyone sees it now — a resident describing itself is sovereign, so nothing waits for a settlement",
    appearance: nodeAnswer(nodes, root),
  };
}

// The acts pen (world-journal.mjs § appendActFlipped): one row, one transaction,
// refused whole when the record cannot be reached.
async function defaultWrite({ actor, action, object, payload, household }) {
  const { appendActFlipped } = await import("./world-journal.mjs");
  const { currentCrossing } = await import("./crossings.mjs");
  try {
    const out = await appendActFlipped(null, { actor, action, object, payload, household, cls: APPEARANCE_CLASS, crossing: currentCrossing() });
    return out.actId == null ? null : String(out.actId);
  } catch (e) {
    if (e?.name === "PenUnreachableError" || e?.name === "NoRecordError")
      throw bounce(503, "the office's record cannot be reached — nothing was written, and nothing was lost", "try again shortly");
    throw e;
  }
}
