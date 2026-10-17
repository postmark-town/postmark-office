// mark-bodies.mjs — Darko's 2026-10-14 22:33 ruling, as a check: every read that
// shows a mark includes its WHOLE body. `unbodied(answer)` walks an answer and
// names every path where a mark is shown without one:
//   · an object carrying a mark id as `id` and no string `body` beside it;
//   · a mark id said as a bare string anywhere (it should be a row with a body);
//   · a place NAMED inside place words ("<inner>, <outer>", "near <place>") with
//     no row of that name beside the words, in `within` or `near`. A name in a
//     sentence is invisible to the first two (review-559, 10-14, Addendum 3).
// `exempt` names keys whose string values are not marks (an event's post id).
// `words` names the keys that hold place words (world.mjs § placeWordsFrom).

export const MARK_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*$/;

/** The place names place words say: "open ground" names none; "aboard <vessel>" is said by the frame block. */
export function placeNames(words) {
  const w = String(words ?? "").trim();
  if (!w || w === "open ground" || /^aboard /.test(w)) return [];
  if (/^near /.test(w)) return [w.slice(5)];
  return w.split(", ");
}

export function unbodied(answer, { exempt = ["event"], words = ["here", "where"] } = {}) {
  const out = [];
  const walk = (v, path, key) => {
    if (typeof v === "string") {
      if (MARK_ID_RE.test(v) && key !== "id" && !exempt.includes(key)) out.push(`${path}: a bare mark id "${v}"`);
      return;
    }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, key)); return; }
    if (typeof v.id === "string" && MARK_ID_RE.test(v.id) && typeof v.body !== "string") out.push(`${path}: mark ${v.id} without its body`);
    for (const k of words) {
      if (typeof v[k] !== "string") continue;
      const rows = new Set([...(Array.isArray(v.within) ? v.within : []), ...(v.near ? [v.near] : [])].map((m) => m?.name));
      for (const name of placeNames(v[k])) if (!rows.has(name)) out.push(`${path ? `${path}.` : ""}${k}: names "${name}" with no row of it beside the words`);
    }
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k);
  };
  walk(answer, "", null);
  return out;
}
