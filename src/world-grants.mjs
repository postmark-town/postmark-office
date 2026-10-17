// world-grants.mjs — THE PERMISSION CALCULUS, as three channels.
//
// ── THE LAW THIS IMPLEMENTS ──────────────────────────────────────────────────
//
// LOGOS/classes.md § Class-nodes has said since 2026-08-15, verbatim:
//
//   "The resident class carries every resident's standing capabilities,
//    world-wide by its own ambient declaration; a ground's class may grant
//    more to those it reaches."
//
// The office implemented only the first half. `gatherActions` asks the store
// for class marks whose id is on the caller's spine or in their reach — but a
// class mark is DE-SITED (LOGOS, 2026-08-18: "law has no where"), so it can
// never BE on a geometric spine. The second clause therefore reached nothing,
// and had reached nothing for eleven days: the only doors that ever opened were
// the ambient ones. That is not a bug in the SQL; it is a missing seam.
//
// This module is the seam. It resolves the marks a caller is standing on to the
// CLASSES they are instances of, and reads those classes' contracts. Plus the
// third channel LOGOS § The three channels names beside it — what you carry.
//
//   ambient        what you ARE      the actor class's own `ambient: true` grants
//   ground         where you STAND   the class of each mark on your spine/reach
//   held           what you CARRY    the `held-grant` on a thing in your hands
//
// ── WHY THE GROUND GRANTS THROUGH ITS CLASS AND NEVER THROUGH THE INSTANCE ───
//
// An instance that could mint its own verbs would be a private grammar with a
// fence around it (atom 1), and the store's own gate already says so: a mark
// mints a verb only if it is `by: the-town`, `tier: constitution`, and standing
// in the Keeping Works. Rei's parcel is none of those and must not become any
// of them. So the resolution is instance → class NAME → the class mark, and the
// class mark passes the same gate it always did. Nothing here widens that gate.
//
// ── AND WHY `held` HAS A DIFFERENT CUSTODY ──────────────────────────────────
//
// A held thing is an INSTANCE — that is the whole point of a magic weapon: two
// of them differ. So the held-grant lives on the object (the `held-grant` slot,
// unsealed on the thing class), and the custody is AUTHORSHIP: `by: the-town`.
// Tier is the obvious guard and it is the wrong one, because atom 11 says tier
// is never asserted and standing is derived from ground — and a held thing has
// no ground. It is not ground (the-not-ground), and it rides its holder
// (the-anchor). A constitution-tier object lying on a floor would be claiming a
// standing its own position law forbids it.
//
// PURE. No store handle, no clone, no network — rows in, entries out. The apex
// owns the queries; this owns the law. That split is what lets the falsifiers
// assert the law without standing up a world.

/** The three channels, most specific first. Order IS the precedence. */
export const CHANNELS = Object.freeze(["held", "ground", "ambient"]);

/** The one relation `scope:` knows today. LOGOS § The three channels: "today
 *  there is exactly one value, `own-ground`". A second one is a law change. */
export const SCOPE_OWN_GROUND = "own-ground";

/**
 * The actor kind a grant entry is for.
 *
 * LOGOS § The human class, verbatim: "An action entry on a class mark may carry
 * `for:` — the actor kind the grant binds. Absent means resident: the default
 * that was always the intent, made explicit the day a second kind needed
 * naming." So the absent case is not "any kind" — it is one specific kind, and
 * reading it as a wildcard is exactly the widening sweep 914ddc26 made.
 */
export const kindOf = (entry) => String(entry?.for ?? "resident");

/**
 * The class a MARK is an instance of.
 *
 * Two spellings on the record and they are not interchangeable. A mark that
 * carries `class:` names its class outright (`class: thing`, `class: bounty`,
 * and now `class: portal-ground`). A mark that carries none is an instance of
 * the class its KIND names: `kind: parcel` is a parcel, `kind: sited` is a
 * mark. Rei's parcel carries no `class:` line at all and is unquestionably a
 * parcel, so a resolver that only read `class:` would find the parcel contract
 * unreachable — which is the shape of the eleven-day gap.
 *
 * A mark standing IN THE WORKS is a DECLARATION, not an instance (the store
 * stamps `declares`), so it resolves to nothing: the class mark for `parcel` is
 * not itself a parcel, and reading it as one would let a caller standing in the
 * Keeping Works collect every contract in the registry.
 */
export function classOfInstance(row) {
  if (!row) return null;
  if (row.declares) return null;
  const named = markClassOf(row);
  if (named) return PREDICATE_KINDS.has(named) ? null : named;
  if (kindFieldOf(row) === "sited") return "mark";
  return null;
}

// ── THE KIND RUNG (LOGOS v2; classes.md § kind, ruled 2026-10-16 15:43/16:02) ──
//
// "`kind` is a flat field naming the node's own class … The `class:` field
// folds into `kind`: … `kind: candy` names `the-town/candy`." Until the
// instance migration (W2) lands, the record holds BOTH spellings of one fact:
//
//   the old form   kind: sited  + class: thing     kind names a standing
//   the new form   kind: thing                     kind names the class
//
// and a `kind: parcel` mark was already the new form. Every reader asks these
// three functions, so the two forms are one question with one answer, and the
// migration can land after the readers instead of with them.

/** The old form's standings: a `kind` with one of these names how a mark stands, not its class. */
export const STANDING_KINDS = Object.freeze(["sited", "predicated"]);
/** The predicate family, in either form (naming is a predicate whose claim is a name). */
export const PREDICATE_KINDS = new Set(["predicated", "predicate", "naming"]);
/** Class-space nodes: a declaration, never an instance. */
export const NODE_KINDS = Object.freeze(["class", "property"]);

/** The `kind` field as either source spells it: the store's row keeps it as `subkind` (its `kind` is `mark`). */
export const kindFieldOf = (m) => String((m?.subkind !== undefined ? m.subkind : m?.kind) ?? "").trim();

/**
 * The class a mark NAMES, in either form, and nothing else: no `declares`
 * rule, no grant semantics. `class:` when the mark carries one (the old form);
 * otherwise its `kind`, unless that kind is a standing (`sited`, `predicated`)
 * or class-space (`class`, `property`), which name no class of their own. A
 * plain sited mark names none, exactly as `m.class` was undefined on it.
 */
export function markClassOf(m) {
  if (!m) return null;
  const named = m.class == null ? "" : String(m.class).trim();
  if (named) return named;
  const kind = kindFieldOf(m);
  if (!kind || STANDING_KINDS.includes(kind) || NODE_KINDS.includes(kind) || kind === "mark") return null;
  return kind;
}

/**
 * The class a CLASS NODE declares, in either form: its `class:` field (the old
 * form), or its own slug when it is `kind: class` without one ("a class node's
 * name is its own slug", ruled 16:02).
 */
export function classNodeNameOf(m) {
  if (!m) return null;
  const named = m.class == null ? "" : String(m.class).trim();
  if (named) return named;
  if (kindFieldOf(m) !== "class") return null;
  const slug = String(m.slug ?? String(m.id ?? "").split("/").pop() ?? "").trim();
  return slug || null;
}

/**
 * The `class` a projection stores for a mark, in either form: the class it
 * names, or the class a class node declares. A parcel stores none, as it never
 * did (its class is its kind, and the parcel rail draws its instance-of edge),
 * and neither does a predicate or a naming, so the old form projects exactly
 * as it always has.
 */
export function classFieldOf(m) {
  if (!m) return null;
  const kind = kindFieldOf(m);
  if (kind === "class") return classNodeNameOf(m);
  const named = m.class != null && String(m.class).trim() !== "";
  if (!named && (kind === "parcel" || PREDICATE_KINDS.has(kind))) return null;
  return markClassOf(m);
}

/**
 * A class name → its lineage, itself first, up `extends` to the root.
 * `extendsOf(name)` is the caller's reader of the class layer (law snapshot,
 * store or world state); a cycle or a missing link ends the walk, never loops.
 */
export function lineageOf(name, extendsOf) {
  const out = [];
  let at = name == null ? "" : String(name).trim();
  while (at && !out.includes(at) && out.length < 32) {
    out.push(at);
    let up = null;
    try { up = extendsOf?.(at); } catch { up = null; }
    at = up == null ? "" : String(up).trim();
  }
  return out;
}

/**
 * How a mark stands: "sited", "predicate", "class", "property", "node" (a post
 * or an entity: in the tree, but neither of mark's two subclasses), or null
 * when its class's lineage cannot be read. The old form says it outright; the
 * new form says it by lineage, sited and predicate being `mark`'s two mutually
 * exclusive subclasses (ruled 13:56). `parcel` is sited in both forms: on the
 * record before the class tree moved, the parcel class extends `mark` directly.
 */
export function standingOf(m, extendsOf) {
  const kind = kindFieldOf(m);
  if (kind === "sited" || kind === "parcel") return "sited";
  if (PREDICATE_KINDS.has(kind)) return "predicate";
  if (NODE_KINDS.includes(kind)) return kind;
  const line = lineageOf(kind, extendsOf);
  if (line.includes("sited")) return "sited";
  if (line.some((c) => PREDICATE_KINDS.has(c))) return "predicate";
  return line.length > 1 ? "node" : null;
}

/**
 * An `extendsOf` read off a loaded set of marks: each `kind: class` node's own
 * `extends`, first declaration winning. For a reader that holds the marks
 * themselves (a subprocess over the clone) rather than the office's class layer.
 */
export function extendsFromMarks(marks) {
  const ext = new Map();
  for (const m of marks ?? []) {
    if (kindFieldOf(m) !== "class") continue;
    const n = classNodeNameOf(m);
    if (n && !ext.has(n)) ext.set(n, m.extends == null ? null : String(m.extends));
  }
  return (name) => ext.get(String(name)) ?? null;
}

/**
 * A class node's DIALS, in either form (LOGOS v2, lane O1; W1 G3/G5): "Every
 * dial becomes a property, and a locked value is its default" (ruled 16:02),
 * and a dial's property node is named by the dial's key verbatim. So a class's
 * dials are its own top-level `kind: property` children (name → default),
 * PROPERTY FIRST, then whatever `dials:` frontmatter the class still carries.
 * `children` is the class node's direct child marks. Null when neither says
 * anything, as the projections always stored an absent `dials:`.
 */
export function dialsOfClassNode(m, children = []) {
  const old = m?.dials && typeof m.dials === "object" && !Array.isArray(m.dials) ? m.dials : null;
  const props = {};
  for (const c of children ?? []) {
    if (kindFieldOf(c) !== "property") continue;
    const name = String(c.name ?? c.slug ?? String(c.id ?? "").split("/").pop() ?? "").trim();
    if (name && !(name in props) && c.default !== undefined) props[name] = c.default;
  }
  if (!old && !Object.keys(props).length) return null;
  return { ...(old ?? {}), ...props };
}

/** Is this mark sited, in either form? (`kind === "sited" || kind === "parcel"` before the kind rung.) */
export const isSited = (m, extendsOf) => standingOf(m, extendsOf) === "sited";

/**
 * Does this entry's `scope:` admit this actor at this ground?
 *
 * `own-ground` means the actor's own household is the household of the ground
 * granting it — LOGOS § The three channels: "A guest's human standing on the
 * same parcel receives nothing, and that is the point."
 *
 * THREE REFUSALS, and the middle one is the one that matters. An UNKNOWN scope
 * word refuses rather than admitting: a grant scoped by a relation this code
 * does not implement is a grant nobody has checked, and admitting it would make
 * a future law-word silently permissive at every door that predates it.
 */
export function scopeAdmits(entry, { actorHousehold = null, groundHousehold = null } = {}) {
  const scope = entry?.scope == null ? null : String(entry.scope).trim();
  if (!scope) return { ok: true };                       // unscoped: the ordinary case
  if (scope !== SCOPE_OWN_GROUND)
    return { ok: false, why: `this grant is scoped "${scope}", a relation this door does not resolve — an unresolved scope is refused, never assumed` };
  if (!actorHousehold || !groundHousehold)
    return { ok: false, why: "this grant reaches only the ground's own household, and one of the two households could not be read — an unread premise is a refusal, not a pass" };
  if (actorHousehold !== groundHousehold)
    return { ok: false, why: `this ground is ${groundHousehold}'s and you act for ${actorHousehold} — the grant reaches only the ground's own household's human` };
  return { ok: true };
}

/**
 * One class mark row → its grant entries, tagged with the channel and ground.
 *
 * `parse` is injected because the apex already owns the store's JSON quirks and
 * a second parser here would be a second answer to the same question.
 */
export function entriesOfClass(classRow, { channel, ground = null, parse = JSON.parse } = {}) {
  if (!classRow) return [];
  let declared = null;
  try { declared = parse(classRow.actions ?? classRow.affordances ?? "null"); } catch { declared = null; }
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((a) => a && (a.action ?? a.subverb))
    .map((a) => ({
      ...a,
      action: String(a.action ?? a.subverb).trim(),
      for: kindOf(a),
      channel,
      from: classRow.id,
      class: classRow.class,
      ...(ground ? { ground } : {}),
    }));
}

/**
 * THE UNION, filtered by actor kind and by relation, resolved by specificity.
 *
 * `candidates` is every entry the three channels produced. What comes back is
 * what the caller may actually do, one entry per verb.
 *
 * FILTERING BY ACTOR KIND IS NOT COSMETIC, and it fixes a live drift. Before
 * this, a human's `say` matched whichever `say` entry the query returned first
 * — and the resident class is ambient, so a human's words were routinely
 * admitted through the RESIDENT's grant, with `from: the-town/resident` in the
 * answer. The one-grant fence held only because a separate hardcoded list said
 * it did. The record should be what holds it.
 *
 * SPECIFICITY: held over ground over ambient. LOGOS § The three channels:
 * "what you brought with you outranks what the place lends you, which outranks
 * what you merely are." A tie inside one channel resolves to the first entry,
 * which is the store's own order — deterministic, and the tie itself is a lint
 * finding rather than something to invent a rule for.
 */
export function resolveGrants(candidates, { kind = "resident", actorHousehold = null, groundHouseholdOf = () => null } = {}) {
  const rank = (e) => CHANNELS.indexOf(e.channel);
  const admitted = [];
  const refused = [];
  for (const e of candidates) {
    // ── A KIND MISMATCH IS A REFUSAL, AND IT USED TO BE A SILENCE ────────────
    //
    // ⚑ FOUND LIVE 2026-08-29: the founder, standing in the candle-vault as his
    // HUMAN, dispatched `exit` and was told «"exit" is not afforded where you
    // stand». That sentence was false in the way that matters — exit IS granted
    // where he stood, by `the-town/resident`, ambiently and world-wide. What is
    // true is that the grant carries no `for:`, so it defaults to RESIDENT
    // (`kindOf`), and his human is not that kind.
    //
    // This `continue` dropped the entry with no record, so the caller fell all
    // the way through to the apex's "not afforded / walk somewhere else" bounce
    // — which sent a reader looking for a place that affords exit, when every
    // place affords it and none of them to him. A door that answers the wrong
    // question confidently is worse than one that says no.
    //
    // The refusal now RIDES, which is what `refused` has always been for: the
    // apex turns it into «granted here, but not to you» with a reason, and into
    // the read's `not_yours` block, whose own note says it exists so "a guest's
    // human standing on someone else's parcel" is told WHY "rather than left to
    // infer it from an absence". Scope refusals were recorded there from the
    // day it was written; kind refusals never were. Half the promise, kept.
    //
    // THE ADMISSION RULE IS UNCHANGED. Nothing new is afforded to anybody by
    // this — `admitted` takes exactly the entries it took before. Only the
    // SAYING changes.
    if (kindOf(e) !== String(kind)) {
      refused.push({ ...e, refused: `this door is ${kindOf(e) === "resident" ? "a resident's" : `for a ${kindOf(e)}`}, and you are acting as ${kind === "human" ? "a human" : `a ${kind}`}` });
      continue;
    }
    const s = scopeAdmits(e, { actorHousehold, groundHousehold: e.ground ? groundHouseholdOf(e.ground) : null });
    if (!s.ok) { refused.push({ ...e, refused: s.why }); continue; }
    admitted.push(e);
  }
  const best = new Map();
  for (const e of admitted) {
    const prior = best.get(e.action);
    if (!prior || rank(e) < rank(prior)) best.set(e.action, e);
  }
  // `admitted` rides beside the winners, and it is NOT the same list: `best`
  // keeps ONE entry per action, so two nested grounds granting the same verb
  // collapse to whichever the gather handed over first. Any reader asking
  // WHICH GROUNDS reach this caller — the seat, below — must ask the admitted
  // set, because the winners have already thrown the answer away.
  return { entries: [...best.values()], refused, admitted };
}

/**
 * THE SEAT — the calculus as an actor who may be SEATED reads it.
 *
 * LOGOS/classes.md § The three channels, verbatim (founder-ruled 2026-08-29):
 *
 *   "A ground seats a human when its class actually grants that human something
 *    — an entry whose `for:` names them, admitted through the ground channel,
 *    with the relation `scope:` demands satisfied. This is derived, never
 *    declared: a ground seats whoever it is already lending verbs to, so the
 *    seating and the grant cannot disagree."
 *
 *   "Inside such a ground the human's affordances are the RESIDENT set — walk,
 *    say, enter, exit, give, take, and the ground's own verbs beside them."
 *
 *   "Outside a seating ground, nothing changes. A human affords nothing
 *    ambiently, anywhere, exactly as before."
 *
 * ⚑ SEATING IS DERIVED FROM THE ADMITTED SET, NOT FROM THE CANDIDATES, and the
 * difference is a whole security property. A guest's human standing on somebody
 * else's parcel HAS a candidate entry — the parcel class grants `for: human` —
 * and `scope: own-ground` refuses it. Reading seating off the candidates would
 * seat that guest in a stranger's garden and hand them the resident set there.
 * So the first resolution runs in full, scope and all, and only what SURVIVES
 * it can seat anybody.
 *
 * A resident is never "seated": they hold the resident set by being one, and
 * asking the question of them would be asking whether they may be themselves.
 *
 * ── THE THIRD WAY A SEAT ARISES (world#16, PROPOSED 2026-09-07) ─────────────
 *
 * LOGOS/classes.md § The human class — the handoff, verbatim:
 *
 *   "`hand-to-human` is an ambient grant on the resident class whose residue is
 *    a fleeting node … While a handoff stands, THE HUMAN IS SEATED AT THE
 *    RESIDENT'S STANDING, WHOLE — the seat ruling applies unchanged … This adds
 *    no verb to the human class and no field to any record; IT ADDS ONE MORE
 *    WAY THE DERIVATION 'WHO IS SEATED HERE' COMES OUT TRUE."
 *
 * That last clause is an instruction about where the code goes, and it is why
 * `opts.handoff` is an ARGUMENT to this function rather than a reader inside
 * it. This is the office's ONE answer to who is seated; a second reader living
 * beside it would agree the day it was written and disagree the first time
 * either moved. So the door folds the log and hands the seat over; the calculus
 * decides, once, here.
 *
 * ⚑ A HANDOFF SEAT IS NOT A GROUND, and `seated` therefore stays null for one.
 * Three things downstream read `seated` as a ground id — the apex's `seatBlock`,
 * the walk fence, and `exitAllowed` — and the law's own sentence is why they
 * must not be handed a handoff there: the seat "is the resident's standing, not
 * a ground … it moves with the resident and ends at the ttl, NOT AT A FENCE".
 * So it rides its own key, and a caller that fences on `seated` fences on
 * nothing, which is the correct behaviour rather than an oversight.
 */
export function resolveForActor(candidates, opts = {}) {
  const kind = String(opts.kind ?? "resident");
  const first = resolveGrants(candidates, opts);
  if (kind === "resident") return { ...first, seated: null, handoff: null };

  // ⚑ WHICH GROUND SEATS YOU IS DECIDED BY THE SPINE, NOT BY GATHER ORDER.
  //
  // Nested rooms both seat: the candle-vault sits inside the cellar-door and
  // each grants `for: human`, so `find` returned whichever the store happened
  // to hand over first. That is a tie broken by a sort's accident, and it is
  // not cosmetic here — THE WALK FENCE FOLLOWS THE SEAT, so the accident
  // decided how far a seated human could move: the 5x5 antechamber or the 3x2
  // vault, depending on row order.
  //
  // The OUTERMOST seating ground wins, which is the containing room. A human
  // seated by two nested rooms is seated by both, and pinching their feet to
  // the inner one would stop them crossing a floor a resident crosses freely —
  // against the ruling's own words, "the human can do everything a resident
  // can". `spineIds` is root-first, so the first match is the outermost.
  // ⚑ FROM `admitted`, NOT FROM `entries`. `entries` is one-per-action, so the
  // candle-vault and the cellar-door — both granting `strike` `for: human` —
  // collapse into a single winner and the loser's GROUND disappears with it.
  // Reading the winners made this rule answer whichever room the store listed
  // first, which is the accident it exists to remove. `admitted` is post-filter
  // (kind and scope both applied) and pre-dedupe, which is exactly the set the
  // question needs: every ground that actually reaches this caller.
  const seatable = (first.admitted ?? first.entries).filter((e) => e.channel === "ground");
  const spine = [...(opts.spineIds ?? [])].map(String);
  const depth = (e) => {
    const i = spine.indexOf(String(e.ground ?? ""));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;   // off-spine sorts last, never first
  };
  const seat = spine.length
    ? seatable.slice().sort((a, b) => depth(a) - depth(b))[0]
    : seatable[0];
  // A handoff seats wherever the resident stands, so it is asked AFTER the
  // ground question and answers the same one. Either alone is a seat; both at
  // once is one human seated twice, and the resident set they get is identical
  // because the seat's whole effect is to resolve them against it.
  const handoff = opts.handoff ?? null;
  if (!seat && !handoff) return { ...first, seated: null, handoff: null };

  // The resident set, read against the same law a resident standing here is
  // read against — resolved, not copied. A second list of "what a resident may
  // do" would be a second answer to a question the calculus already owns.
  const asResident = resolveGrants(candidates, { ...opts, kind: "resident" });
  const byAction = new Map(first.entries.map((e) => [e.action, e]));
  for (const e of asResident.entries) {
    // The human's OWN grant wins where both exist: an entry written `for:
    // human` was written for them deliberately, and may differ from the
    // resident's in residue or dials.
    if (!byAction.has(e.action)) byAction.set(e.action, { ...e, via_seat: true });
  }
  return {
    entries: [...byAction.values()],
    // A refusal that the seat has since answered is not a refusal any more.
    refused: first.refused.filter((r) => !byAction.has(r.action)),
    // THE GROUND, or null — never a handoff. See the header note above.
    seated: seat ? (seat.ground ?? seat.from ?? null) : null,
    handoff,
  };
}

/**
 * The held channel's own gate.
 *
 * A thing lends a verb only if the town's pen hung it there. This is the whole
 * anti-escalation property of the channel: `world_leave_mark` stamps `by:` from
 * the caller's key, so a resident cannot author as the town, and therefore
 * cannot hang a verb on their own pocket lantern.
 *
 * Stated as a function rather than inlined because the apex, the lint and the
 * falsifiers must all ask it the same way — a security boundary with two copies
 * is a security boundary with one bug.
 */
export const thingMayLend = (row) => row?.by === "the-town";

/** A held thing's grant entries, or none — the gate first, always. */
export function heldEntries(thingRow, { parse = JSON.parse } = {}) {
  if (!thingMayLend(thingRow)) return [];
  let declared = null;
  try { declared = parse(thingRow?.held_grant ?? "null"); } catch { declared = null; }
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((a) => a && a.action)
    .map((a) => ({
      ...a,
      action: String(a.action).trim(),
      for: kindOf(a),
      channel: "held",
      from: thingRow.id,
      class: thingRow.class ?? "thing",
      held: thingRow.id,
    }));
}

/**
 * The guard a residue class puts in gate position.
 *
 * LOGOS § The derived, verbatim: "Guards are deriveds in gate position: a verb
 * or slot may name a derived and a required value as its precondition — that is
 * the whole condition grammar."
 *
 * `within_class` is the one that fences the portal's verbs to the portal. It is
 * checked against the caller's own containment spine, which is a DERIVED — read
 * at the door, stored by nobody. Without it the held channel is
 * location-independent by construction, and a weapon carried home from a party
 * would grant `strike` on the quay.
 *
 * `phase` is the encounter's own derived and is passed in rather than computed:
 * this module does not know what a fight is, and should not learn.
 */
export function guardsPass(requires, { spineClasses = [], phase = null } = {}) {
  if (!requires || typeof requires !== "object") return { ok: true };
  const want = requires.within_class == null ? null : String(requires.within_class);
  if (want && !spineClasses.includes(want))
    return { ok: false, why: `this act is only performed within a ${want}, and you are not standing in one` };
  const wantPhase = requires.phase == null ? null : String(requires.phase);
  if (wantPhase && String(phase ?? "") !== wantPhase)
    return { ok: false, why: `this act waits for the encounter to be "${wantPhase}"${phase ? `, and it is "${phase}"` : ""}` };
  return { ok: true };
}
