// kind-forms.mjs — a frozen answer, read in the form it was frozen in (LOGOS v2 part 2, W2).
//
// The goldens were captured on a world that files a mark's standing in `kind`
// (`sited`, `predicated`). W2's kind rung files the CLASS there instead (`kind:
// thing`, whose class extends sited) and spells the predicate `predicate`. A
// stakes row carries its mark's `kind` verbatim, so the same mark reads
// `"sited"` on one world and `"thing"` on the other, and a byte-exact golden
// reds on the form rather than on the page.
//
// So a W2 kind is put back in the old form's word, through the world's own
// class chain: a kind whose lineage reaches `sited` reads `sited`, one that
// reaches the predicate reads `predicated`. A word the old form already used
// passes unchanged, so on the world the goldens were captured on this is the
// identity and the comparison is exactly as strict as it was. Two things make
// the comparison red: a kind whose lineage reaches neither is left as it is,
// and, once any row is in the new form, a row whose kind is not its mark's own
// `kind` in the record is marked so (the page must still say what the record
// says; only the form is read back).

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extendsFromMarks, kindFieldOf, standingOf } from "../../src/world-grants.mjs";

/** The words the old form wrote in `kind`, each meaning itself. */
export const OLD_FORM_KINDS = Object.freeze(new Set(["sited", "predicated", "parcel", "naming", "post", "class", "property"]));

/** The clone's own marks, by the world's own loader: its class chain and each mark's `kind`. Read once a clone. */
const read = new Map();
export function worldKinds(clone) {
  if (!read.has(clone)) read.set(clone, readKinds(clone));
  return read.get(clone);
}
async function readKinds(clone) {
  const { loadMarks } = await import(pathToFileURL(join(clone, "tools", "marks-fold.mjs")).href);
  const marks = loadMarks(join(clone, "WORLD", "marks"));
  const byId = new Map(marks.map((m) => [m.id, kindFieldOf(m)]));
  return { extendsOf: extendsFromMarks(marks), kindOf: (id) => byId.get(String(id)) };
}

/** A kind in the old form's word: identity on an old word, the standing for a class. PURE. */
export function oldFormKind(kind, extendsOf) {
  if (typeof kind !== "string" || OLD_FORM_KINDS.has(kind)) return kind;
  const s = standingOf({ kind }, extendsOf);
  return s === "sited" ? "sited" : s === "predicate" ? "predicated" : kind;
}

/**
 * `value` with every `stakes.rows[n].kind` in the old form, wherever a stakes
 * segment stands in it. `worldLater` answers `{ extendsOf, kindOf }` (worldKinds)
 * and is asked only when a row carries a word the old form did not use, so the
 * clone is read only then.
 */
export async function stakeKindsInOldForm(value, worldLater) {
  let world;
  const rows = [];
  const find = (v) => {
    if (Array.isArray(v)) { v.forEach(find); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "stakes" && Array.isArray(x?.rows)) rows.push(...x.rows.filter((r) => r && typeof r === "object"));
      find(x);
    }
  };
  find(value);
  // A page in the old form is the identity and never reads the clone. Once one
  // row is in the new form, the clone is read and EVERY row that names a mark is
  // held to that mark's own `kind` (review-617): one that misstates it is marked
  // so, and the comparison reds on it.
  if (!rows.some((r) => typeof r.kind === "string" && !OLD_FORM_KINDS.has(r.kind))) return value;
  world = await worldLater();
  for (const r of rows) {
    if (typeof r.kind !== "string" || r.mark == null) continue;
    const own = world.kindOf(r.mark);
    if (own !== r.kind) { r.kind = `${r.kind} (the record says ${own ?? "no such mark"})`; continue; }
    r.kind = oldFormKind(r.kind, world.extendsOf);
  }
  return value;
}
