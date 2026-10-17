// mark-record.mjs — the on-disk record grammar, with exactly one writer.
//
// A mark's `mark.md` has a serialization: which frontmatter fields appear, in
// what order, formatted how, and how the body is joined to them. Until POS-5
// that grammar lived inside `leave-exec.mjs` as a local `fmtVal` and a local
// field list, which was correct while exactly one thing wrote records.
//
// The drain (slice 2) is the second writer. Two copies of a serialization is
// how two eras come to disagree about the bytes of the same declaration — and
// the disagreement would be invisible, because both would parse. So the grammar
// moves here, `leave-exec.mjs` imports it, and the drain imports the same
// function. That is what makes "a drained record is byte-identical to what the
// git door would have written" a falsifiable claim rather than a hope.
//
// This module is PURE and dependency-free on purpose: no fs, no git, no clone.
// The frame conversion (world coordinates → the parent's frame, SCHEMA v3) is
// the CALLER's, because it needs the fold; this only serializes what it is
// handed. See `WORLD/marks/SCHEMA.md` in the world repo for the format's law.

/**
 * One value, serialized the way the record parser reads it back.
 *
 * Inline object (`{ x: 1, y: 2 }`), JSON array (`[[0,0],[1,1]]`), or a bare
 * scalar. The shapes are the ones `marks-fold.mjs § parseRecord` and
 * `parseDeltaRecord` know how to read.
 *
 * ── THE OBJECT BRANCH IS THE READER'S, AND IT HAS TWO ARMS (2026-09-12) ──────
 *
 * The original had one: `{ k: v }` for every object. That form is readable ONLY
 * for an all-numeric object, because the reader's fallback scan is a number scan
 * — `marks-fold.mjs:83`: `pair.match(/([\w]+)\s*:\s*(-?[\d.]+)/)`, quoted whole
 * so a drift in it is a drift from this line. It captures a numeric pair and
 * NOTHING else, and it splits on `,`.
 *
 * So a structured value written in the bare form does not come back diminished,
 * it comes back EMPTY, and a nested one never even gets that far: measured on
 * prod's store against world main, `the-town/the-wheelhouse`'s `timetable` and
 * `wright/the-candle-vault`'s `dials` render `[object Object]` through the bare
 * form, and `the-town/the-post-office`'s `entry` renders a value whose own prose
 * carries the `, ` the scan splits on. Three marks, three different ways for one
 * form to be wrong.
 *
 * The reader tries STRICT JSON FIRST (`marks-fold.mjs:79`, and its own comment
 * says why: "the shape a structured field like `timetable:` needs"). So a
 * structured value goes out as strict JSON and comes back identical.
 *
 * THIS CHANGES NOTHING THE DOOR WRITES TODAY, and that is measured rather than
 * argued: the only object-valued fields in `RECORD_FIELDS` are `at` and
 * `extent`, both `{x,y}`/`{w,h}` number pairs on all 1,044 standing rows, so
 * both keep the bare form they have always had. The arm below is reached only by
 * the authored pass-through, which had no reader before this date.
 */
const allNumeric = (v) => Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));

export const fmtVal = (v) => Array.isArray(v) ? JSON.stringify(v)
  : (v && typeof v === "object") ? (allNumeric(v)
    ? `{ ${Object.entries(v).map(([k, n]) => `${k}: ${n}`).join(", ")} }`
    : JSON.stringify(v))
  : String(v);

/**
 * THE FIELD ORDER, and it is part of the grammar rather than a detail: two
 * writers emitting the same fields in different orders produce different bytes
 * for the same mark, and every diff in the world repo would show a rewrite
 * where nothing changed.
 *
 * `tier` sits after `by`, and it is written for ONE VALUE ONLY — see `EMITS`
 * below. The door refuses the field from an author ("standing is derived from
 * the ground your mark stands on, never asserted by the author", ruled
 * 2026-08-12, applied 2026-08-13) and that stands: `leave-exec.mjs` still
 * answers 422 to a payload carrying it, and the office's declaration
 * (`world.mjs § clean`) never includes it, so neither the git door nor the
 * drain can reach this list with a `tier`. The G1 fold can: it renders from the
 * store, and the store carries a DERIVED `data.tier` on every standing row
 * (1,031 of 1,031, measured 2026-09-09 — `home` 422 / `market` 231 on resident
 * rows, `constitution` 319 / `market` 59 on the town's). Written unconditionally
 * that would put the walk's verdict on every resident record as if the author
 * had asserted it — what the world's own gate refuses (`tools/mark-lint.mjs §
 * an AUTHORED tier: is residue`) and what a store crossing would rewrite on 27
 * of window 177's 33 docket marks (measured; the standing flip rose 717 → 911).
 *
 * `version` is LAST, and it is here for the G1 fold (ruled 2026-09-08 18:1x):
 * the town's own law plaques carry `version:` as their final frontmatter line
 * (`the-town/co-sign-guard`, `come-ashore-trigger` … five standing rows, all
 * `by: the-town`), and a store-side render that dropped it would rewrite them
 * at the first store crossing. It reaches a resident record from NOTHING: the
 * office builds a declaration from named keys only (`world.mjs § clean`), so
 * neither the git door (`leave-exec.mjs`) nor the drain (a journal payload IS
 * that declaration) can be handed one — measured on the store, no resident row
 * carries `data.version`.
 */
export const RECORD_FIELDS = Object.freeze([
  "kind", "by", "tier", "date", "at", "extent", "points",
  "slot", "value", "class", "ask", "reward", "status", "image",
  "version",
]);

/**
 * THE KEYS THE PASS-THROUGH REFUSES, and every name here is a measurement.
 *
 * `markRecord` writes the fifteen above and then EVERY OTHER KEY OF THE RECORD
 * (ruled by Keemin, 2026-09-12 00:4x): "let them through. The renderer is dumb:
 * what a resident wrote comes back out of the store the way it went in.
 * Structure is enforced where something reads it — mark-lint, the tests, the
 * docket — never at the pen." Before that ruling the fifteen were the whole
 * grammar, and a store crossing DELETED every other authored line from the file
 * it rewrote: 507 of 1,044 standing marks carry `derived_from` and `pre` alone,
 * the store carries them faithfully, and the loss was at render
 * (`docs/2026-09-11/jetto-w38-store-rehearsal-report.md § THE FINDING`; it fired
 * on `claude-of-tulip/the-headland` at the 17:45Z 09-11 crossing, which one test
 * happened to name — the other 506 would have gone silently).
 *
 * A BLANKET pass-through is the other wrong answer, and this list is the reason
 * it is not what shipped. Two different families of key ride a record without
 * ever having been authored, and writing either onto a resident's file puts
 * words in their mouth.
 *
 * ── FAMILY 1 · THE STORE'S OWN DERIVED KEYS ──────────────────────────────────
 *
 * Measured on prod's store READ-ONLY 2026-09-12 04:5xZ (1,044 standing rows) and
 * on world main `7ffa420f`'s 1,199 `mark.md` files, key set against key set. A
 * key is DERIVED when the store carries it and no file ever authored it:
 *
 *   locked_by        146 rows, 0 files   — always the string "founder"
 *   founder_commit   146 rows, 0 files   — {at, sha, subject}, the seating stamp
 *   parent_id         17 rows, 0 files   — containment is the PATH's, never a line
 *   formerly           4 rows, 0 files   — 012_reidentification's rename trail
 *
 * `tier` is the same class and is handled one layer up: it is IN the fifteen
 * with an `EMITS` rule, because it has exactly one file-side reader. It is on
 * 1,044 of 1,044 rows (`home` 428 / `market` 297 / `constitution` 319), and
 * writing it unconditionally is what the world's own gate refuses
 * (`tools/mark-lint.mjs:189 § an AUTHORED tier: is residue`).
 *
 * ── FAMILY 2 · THE DOOR'S AND THE DRAIN'S TRANSPORT KEYS ─────────────────────
 *
 * ⚑ THE BRIEF SAID THIS FAMILY COULD NOT EXIST, AND THE MEASUREMENT SAYS IT CAN.
 * It read: "the git door (`leave-exec.mjs`) and the drain build records from
 * named keys only (`world.mjs § clean`), so no extra key can reach them."
 * `world.mjs § clean` IS built from named keys only — and six of those named
 * keys are transport, not frontmatter:
 *
 *   leave-exec.mjs:295  `const fileRec = { ...p }` — p IS `clean`, so a blanket
 *                       pass-through writes slug, body, household, parent_id,
 *                       amend and stamps into every new mark.md. `body:` would
 *                       be the whole body, duplicated into a frontmatter line.
 *   world-drain.mjs:232 `fileRec = { ...p, … }` then deletes FOUR — slug, body,
 *                       parent_id, household — and the journal declaration
 *                       (world.mjs:2126) carries `stamps` and `put_forward`
 *                       past that delete.
 *
 * None of the six appears on any of world main's 1,199 files. They are refused
 * here rather than by widening the two doors, because the renderer is the one
 * place that decides what is written — the whole argument of this module.
 *
 * A NAME ADDED HERE MUST CARRY ITS MEASUREMENT. The question this list answers
 * is never "does this look internal" but "does any file author it" — and that
 * is a count, on the corpus, on the day.
 */
export const DERIVED = Object.freeze([
  // family 1 — the store derives these; no file authors them
  "locked_by", "founder_commit", "parent_id", "formerly",
  // family 2 — the door and the drain carry these; they are not frontmatter
  "slug", "body", "household", "amend", "stamps", "put_forward",
]);

const RECORD_FIELD_SET = new Set(RECORD_FIELDS);
const DERIVED_SET = new Set(DERIVED);

/**
 * THE GRAMMAR MIRRORS ITS READER, BY VALUE (ruled 2026-09-08 21:3x): a field
 * is written only where something on the file side READS it, and `tier` has
 * exactly one reader. The world's fold takes the file's own line —
 * `tools/marks-fold.mjs:329`: `rec.tier = rec.tier ?? "market";` — into the
 * standing walk's one shortcut, `world2/tools/standing.mjs:376` (transcribed
 * from the world's own):
 *
 *   if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
 *
 * `market` and `home` are DERIVED by the walk and never read from a file, so a
 * door writing them would be a value with no reader (the 2026-09-08 class,
 * three instances in one lane).
 *
 * THE RULE IS THE GATES' OWN PREDICATE, WHOLE (sharpened 2026-09-08 21:4x):
 * `by === the-town AND tier === constitution`. Three readers on the file side
 * carry that exact pair, quoted verbatim so a drift in any of them is a drift
 * from this line:
 *
 *   world `tools/mark-standing.mjs:91` / office `world2/tools/standing.mjs:376`
 *     if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
 *   world `tools/mark-lint.mjs:189` — the gate that refuses every other tier line
 *     if (rawTier && rawTier !== "draft" && !(rec.by === TOWN && rawTier === "constitution"))
 *
 * So the `by` half here is the reader's, not a selector of the door's own
 * invention (keying a grammar on authorship by itself was refused). On today's
 * corpus the two halves are redundant — measured on world main `cab0da3a`
 * before either was written: 480 canon files carry a `tier:` line, all 480 read
 * `constitution`, all 480 are `by: the-town`; the 319 with a store row agree
 * with `data.tier` 319 of 319; no resident row reads `constitution` (0 of 653)
 * — which means the `by` clause CANNOT be driven red by any captured row. What
 * would red it is a hand-written record carrying `tier: constitution` under a
 * resident's `by:`, the shape `world-drain.mjs`'s `fileRec = { ...p }` would
 * hand this grammar if a journal payload ever carried the word; the test holds
 * exactly that record.
 *
 * ── `source` WAS ONE NAME OVER TWO FACTS; THE STAMP MOVED, THE RULE STAYS ────
 *
 * It could not go in `DERIVED`, because residents DO author it, and it could not
 * be let through by name, because the store also stamped it. Measured the same
 * way as `DERIVED`, on prod 2026-09-12 against world main `7ffa420f`:
 *
 *   source as a STRING   32 rows, and the file carries the line on all 32
 *                        — a LOGOS pointer: "LOGOS/classes.md", "WRITES.md", …
 *   source as an OBJECT  146 rows, and NO file carries it as an object
 *                        — {at, sha, kind, subject}, the ingest's provenance
 *
 * The split was total: string ⇒ authored 32 of 32, object ⇒ derived 146 of 146.
 * `the-town/the-reach` is the row that made the rule necessary rather than
 * merely tidy — its FILE reads `source: LOGOS/classes.md` and its store row
 * carried the provenance object, so a pass-through by name would not have added
 * a line, it would have OVERWRITTEN an authored one with a stamp.
 *
 * ── THE NAME COLLISION IS FIXED AT THE WRITER, AND THIS RULE IS NOW A GUARD ──
 *
 * RULED 2026-09-12 (Keemin: "we can have the underscore `_source` to
 * differentiate. I think that's fine"). The one writer of the object —
 * `world2/tools/backfill-register.mjs § backfillAdmission`, and it is one
 * writer, established by grepping every `data.source` / `->'source'` /
 * `'source'` in the repo — now stamps under `_source`, which line 283 below
 * refuses structurally because it begins with an underscore. The 146 rows
 * already in the store move by `world2/schema/017_source_underscore.sql`, which
 * also gives `the-town/the-reach` its authored string back.
 *
 * SO THIS RULE IS MOOT — AND IT STAYS. It costs one `typeof` per render, and it
 * is the falsifier that catches a writer this rename missed or a future one that
 * reaches for the resident's word again: the day a store row carries an object
 * under `source`, the resident's file still does not get a stamp written into
 * it. A guard whose predicate has become unreachable on today's corpus is not
 * dead code; it is the reason the corpus looks that way.
 */
export const EMITS = Object.freeze({
  tier: (v, record) => (record?.by ?? record?.household) === "the-town" && v === "constitution",
  source: (v) => !(v !== null && typeof v === "object"),
});

/**
 * A mark record's bytes: frontmatter, then the body, then one trailing newline.
 *
 * A field that is undefined, null or the empty string is OMITTED rather than
 * written empty — that is the door's rule and the reason a bare thing does not
 * carry `ask: undefined` into permanent canon. A field with an `EMITS` rule is
 * written only for the values that rule admits.
 *
 * ── WHAT IS WRITTEN, IN ORDER (the pass-through, 2026-09-12) ─────────────────
 *
 * `RECORD_FIELDS` first, in their order, exactly as before — that order is part
 * of the grammar and moving it would show a rewrite on every mark in the world
 * repo. Then EVERY REMAINING KEY OF THE RECORD that is authored: not
 * underscore-prefixed (`_fileAt`, `_origin`, `_stray`, `_parentMarkId`,
 * `_parent_is_law`, `_journal_seq`, `_act_id` — the parser's own internals, 979
 * rows at the top of that list), not in `DERIVED`, and admitted by its `EMITS`
 * rule if it has one.
 *
 * ── THE ORDER OF THE REMAINDER IS ALPHABETICAL, AND THE STORE IS WHY ─────────
 *
 * The brief's first choice was the authored order, if the store kept one. IT
 * KEEPS NONE, and this is the measurement rather than a reading of the docs:
 * `marks.data` is `jsonb` (`world2/schema/004_marks_data.sql`), which normalises
 * key order to length-then-bytewise and has no room to remember another; no
 * table anywhere in `world2/schema/*.sql` stores the record's raw frontmatter or
 * its key order. Compared row by row on prod 2026-09-12 — over just the keys a
 * row and its file share, the store's order equals the file's on 281 of 1,044
 * and differs on 763. So there is nothing to preserve, and alphabetical is
 * chosen because it is STABLE: the alternative, "whatever order jsonb hands
 * back", makes the bytes of a mark a function of Postgres's storage layout.
 *
 * The cost is named and was accepted in advance (Keemin, 2026-09-12): the first
 * crossing to write down a mark that carries authored extras moves those lines
 * to the end of its frontmatter, ONCE. It is a reordering, not a loss, and it is
 * bounded by the marks a crossing actually publishes. Measured over all 1,044
 * standing rows against world main `7ffa420f`: 537 marks would be reordered and
 * not otherwise changed.
 *
 * ── `version` STAYS THE LAST LINE, and the tie was broken by measuring ───────
 *
 * The remainder goes AFTER the named fields but BEFORE `version`, which keeps
 * true the invariant `RECORD_FIELDS` states above ("`version` is LAST … the
 * town's own law plaques carry `version:` as their final frontmatter line").
 * The alternative — the remainder strictly last — was rendered over the same
 * 1,044 rows and scores IDENTICALLY: byte-equal 471, order-only 537, otherwise
 * 36, both ways. Exactly one row in the corpus carries a `version` AND a
 * pass-through key (`the-town/the-wheelhouse`), so the two orders can only
 * differ on that one mark, and only this one keeps the invariant. Same cost,
 * one fewer stated property broken.
 */
/**
 * THE KIND A NEW FILE WRITES (LOGOS v2, W2's rename, settled on WLD-73 G10):
 * a description is `kind: predicate`, never the old `predicated`; every
 * other kind is written as declared. Readers take both spellings (world-grants
 * § PREDICATE_KINDS); only what is newly written moves.
 */
export const recordKindOf = (kind) => (kind === "predicated" || kind === "predicate" ? "predicate" : kind);

export function markRecord(record, body) {
  const written = (k) => record[k] !== undefined && record[k] !== null && record[k] !== ""
    && (!(k in EMITS) || EMITS[k](record[k], record));
  const named = RECORD_FIELDS.filter(written);
  const passed = Object.keys(record)
    .filter((k) => !RECORD_FIELD_SET.has(k) && !k.startsWith("_") && !DERIVED_SET.has(k))
    .filter(written)
    .sort();
  const last = named[named.length - 1] === "version" ? named.pop() : null;
  const fm = [...named, ...passed, ...(last ? [last] : [])]
    .map((k) => `${k}: ${fmtVal(record[k])}`).join("\n");
  return `---\n${fm}\n---\n\n${String(body).trim()}\n`;
}
