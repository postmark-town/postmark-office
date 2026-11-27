import { actsQuery } from "./world2-acts.mjs";
import { settlementsFrom } from "./settlements.mjs";

async function queryRows(p, sql, params = []) {
  return p ? (await p.query(sql, params)).rows : actsQuery(sql, params);
}

const isoZ = (t) => (t == null ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));

/** The store's settlements, in 1.0's own shape, plus the newest window one closed. */
export async function storeSettlements(p) {
  const rows = await queryRows(p,
    `SELECT number, tag_sha, published_at, window_id, blessed_at
       FROM settlements ORDER BY number DESC`);
  if (!rows) return null;
  const lines = rows.map((r) => ({ tag: `settlement/S${r.number}`, sha: r.tag_sha, date: isoZ(r.published_at) }));
  const settledWindow = rows.reduce((w, r) => (r.window_id == null ? w : Math.max(w, Number(r.window_id))), -Infinity);
  return { rows, ...settlementsFrom(lines), settledWindow };
}

// Read only the write-down for the newest blessed world. An earlier hold
// cannot establish what happened when a later settlement tried the filing.
export async function lockedReceiptFacts(p = null, settled = undefined, publishedSha = null) {
  if (settled === undefined) {
    try { settled = await storeSettlements(p); } catch { settled = null; }
  }
  const settled_window = Number.isFinite(settled?.settledWindow) ? settled.settledWindow : null;
  const sha = settled?.rows[0]?.tag_sha;
  let held_path_collision = [];
  if (settled_window != null && sha && (!publishedSha || sha.startsWith(publishedSha))) {
    try {
      const rows = await queryRows(p,
        `SELECT receipt FROM crossing_receipts WHERE status = 'published' AND world_to = $1 ORDER BY id DESC LIMIT 1`, [sha]);
      const store = rows?.[0] && JSON.parse(rows[0].receipt)?.store;
      if (store?.ran === true && store.rehearsal === false && Array.isArray(store.held_path_collision))
        held_path_collision = store.held_path_collision;
    } catch { /* The window is independently recorded, even without a readable write-down. */ }
  }
  return { settled_window, held_path_collision };
}

export function heldFiling(facts, id, window) {
  if (window == null || facts.settled_window == null || !(Number(window) <= facts.settled_window)) return null;
  return facts.held_path_collision?.find((h) => h?.id === id && h.locked_window != null
    && String(h.locked_window) === String(window) && h.crossing_output === "path-held-by-another-id"
    && typeof h.held_by_filing_of === "string" && h.held_by_filing_of.trim() && h.held_by_filing_of !== id) ?? null;
}
