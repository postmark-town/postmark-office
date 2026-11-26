// housemate-evidence.mjs — what a resident's move out of a house that keeps others would NOT carry, and what
// the resident acts with (POS-1162, tools/move-housemate.mjs's dry run). Reads only; writes nothing, ever.
//
// THE RULE IS ONE SENTENCE: a fact this file could not read is `{ unavailable: "<why>" }`, never a zero,
// never an empty list, never a cleared check. A reviewer reading a dry run must be able to tell "none"
// from "could not look" (the #2454 shape, in `world2-acts.mjs § actsQuery`'s words).
//
// ── THE HISTORY COUNTS ──────────────────────────────────────────────────────
// Rows keep the spelling they were written with for life (024_household_spellings.sql), so after the move
// every row spelled `hh:<source>` (or a former key, or one of the source's `gh:<id>` accounts) stays the
// SOURCE's. The counts below say how many of the mover's rows that is, table by table. The office reads
// through `office_api`, and four of these tables are under row-level security that compares `household`
// with the transaction's declared spelling set (`world2-claims.mjs § withHousehold`). So every count is
// taken inside `withHousehold(pool, "hh:<source>")`: the source's own spelling set, exactly what its
// residents' sessions see. A public table (acts, non-draft claims, marks) answers for every spelling it
// holds; a private one answers for the source's set only, and says so (`scope`). Each table is asked
// under its own SAVEPOINT, so one that cannot be read (a store that has not taken its migration, a
// refused SELECT) says so by name and the others still answer.
//
// ── THE CREDENTIAL IMPACT (Wright's settled scope, POS-1162) ────────────────────────────────────
// A membership move cannot by itself make a mover's NEW acts the town's: a static office key names its own
// household (070), and a GitHub sign-in reaches a house through the account's `accounts[]` entry. So per
// handle this reports, from non-secret metadata only, which key or sign-in the handle acts with and whether
// it is bound to the source: the handle's pinned account and whether the source (or the target) lists it,
// the static-key rows that name the handle (their household, never the key or its hash), and a count of
// the live sign-in keys the pinned account holds. It changes nothing and rules nothing: credentials stay
// with POS-448.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withHousehold } from "./world2-claims.mjs";
import { importTownTool } from "./town-tool.mjs";

const LEDGER = "WHITE_PAGES/stamp-ledger.md";

/** One line, short: the reason a fact is unavailable. Never a row, never a parameter. */
export const why = (e) => String(e?.code ? `${e.code}: ${e.message}` : (e?.message ?? e)).split("\n")[0].slice(0, 140);

// ── history ─────────────────────────────────────────────────────────────────

// `scope`: "public" = the table is readable whole, so the count covers every spelling the mover's rows wear;
// "source set" = row-level security shows only rows spelled in the source's spelling set.
const HISTORY = Object.freeze([
  { name: "acts", scope: "public", sql: "SELECT household, count(*)::int AS n FROM acts WHERE actor = $1 GROUP BY household" },
  { name: "claims", scope: "public (drafts: source set)", sql: "SELECT household, count(*)::int AS n FROM claims WHERE claimant = $1 GROUP BY household" },
  { name: "marks", scope: "public", kinds: true, sql: "SELECT household, kind, count(*)::int AS n FROM marks WHERE owner = $1 GROUP BY household, kind" },
  { name: "letters (letter_opens)", scope: "source set", sql: "SELECT household, count(*)::int AS n FROM letter_opens WHERE handle = $1 GROUP BY household" },
  { name: "notes (resident_notes)", scope: "source set", sql: "SELECT household, count(*)::int AS n FROM resident_notes WHERE handle = $1 GROUP BY household" },
  { name: "notes (letter_notes)", scope: "source set", sql: "SELECT household, count(*)::int AS n FROM letter_notes WHERE marked_by = $1 GROUP BY household" },
]);

// The mark kinds whose slugs are named: the ground, parcels and homes the resident owns. A slug is a public path.
const GROUND_KINDS = Object.freeze(["parcel", "sited", "home"]);
const SLUG_CAP = 25;

function fold(rows, keys, spec) {
  const inSet = {};
  const byKind = {};
  let total = 0;
  let inSetTotal = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    if (!keys.includes(r.household)) continue;
    inSetTotal += n;
    inSet[r.household] = (inSet[r.household] ?? 0) + n;
    if (spec.kinds) byKind[r.kind] = (byKind[r.kind] ?? 0) + n;
  }
  return {
    scope: spec.scope,
    in_source_set: inSetTotal,
    by_spelling: inSet,
    ...(spec.kinds ? { by_kind: byKind } : {}),
    outside_source_set: spec.scope === "public" ? total - inSetTotal : null,
  };
}

/**
 * The mover's rows that stay the source's, by table. `pool` is a pg pool as `office_api`; `from` the source
 * slug. Answers `{ spelling_set, tables: { <name>: counts | { unavailable } }, ground }`, or `{ unavailable }`
 * when even the source's spelling set could not be declared.
 */
export async function historyCounts({ pool, handle, from }) {
  try {
    return await withHousehold(pool, `hh:${from}`, async (client, keys) => {
      const tables = {};
      for (const spec of HISTORY) {
        await client.query("SAVEPOINT housemate_count");
        try {
          const { rows } = await client.query(spec.sql, [handle]);
          await client.query("RELEASE SAVEPOINT housemate_count");
          tables[spec.name] = fold(rows, keys, spec);
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT housemate_count").catch(() => {});
          tables[spec.name] = { unavailable: why(e) };
        }
      }
      let ground;
      await client.query("SAVEPOINT housemate_ground");
      try {
        const { rows } = await client.query(
          "SELECT slug, kind, status FROM marks WHERE owner = $1 AND kind = ANY($2::text[]) ORDER BY slug", [handle, [...GROUND_KINDS]]);
        await client.query("RELEASE SAVEPOINT housemate_ground");
        ground = { count: rows.length, slugs: rows.slice(0, SLUG_CAP).map((r) => `${r.kind}:${r.slug} (${r.status})`), capped: rows.length > SLUG_CAP };
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT housemate_ground").catch(() => {});
        ground = { unavailable: why(e) };
      }
      return { spelling_set: [...keys], tables, ground };
    });
  } catch (e) {
    return { unavailable: why(e) };
  }
}

// ── the credential impact ───────────────────────────────────────────────────

const houseWord = (s) => String(s ?? "").split("#")[0].trim().replace(/^hh:/, "");

/**
 * Which key or sign-in `handle` acts with, from non-secret metadata, and whether it is bound to the source.
 * `rows` is the registry rows (`loadRegistryRows`), `pool` a pg pool as `office_api`.
 */
export async function credentialImpact({ pool, handle, from, to, rows }) {
  const source = rows.households.find((r) => r.slug === from) ?? null;
  const target = rows.households.find((r) => r.slug === to) ?? null;
  const pin = (rows.pins ?? []).find((p) => p.handle === handle) ?? null;
  const ghId = pin?.gh_id == null ? null : Number(pin.gh_id);
  const listed = (house) => ghId != null && (house?.accounts ?? []).some((a) => Number(a?.id) === ghId);
  const sourceNames = new Set([from, ...(source?.formerly ?? [])].map(houseWord));
  const sourceIds = new Set((source?.accounts ?? []).map((a) => Number(a?.id)));
  const targetNames = new Set([to, ...(target?.formerly ?? [])].map(houseWord));

  const signIn = {
    pinned_account: pin ? { login: pin.login ?? null, id: ghId } : null,
    listed_in_source: pin ? listed(source) : null,
    listed_in_target: pin ? listed(target) : null,
  };

  let staticKeys;
  try {
    // NEVER token_hash: the key's hash is a credential's derivative and nothing here needs it.
    const { rows: held } = await pool.query("SELECT household, handles, gh_id FROM oauth_tokens WHERE kind = 'static'");
    const named = [];
    for (const r of held) {
      let hs;
      try { hs = JSON.parse(r.handles ?? "[]"); } catch { hs = null; }
      if (!Array.isArray(hs)) { staticKeys = { unavailable: "a static key row's handles did not parse" }; break; }
      if (!hs.includes(handle)) continue;
      const house = houseWord(r.household);
      named.push({
        household: house,
        bound_to_source: sourceNames.has(house) || (r.gh_id != null && sourceIds.has(Number(r.gh_id))),
        bound_to_target: targetNames.has(house),
      });
    }
    staticKeys ??= { count: named.length, keys: named.sort((a, b) => a.household.localeCompare(b.household)) };
  } catch (e) {
    staticKeys = { unavailable: why(e) };
  }

  let liveSignIns;
  if (ghId == null) liveSignIns = { count: 0, note: "the handle has no pinned account" };
  else {
    try {
      const { rows: kinds } = await pool.query(
        "SELECT kind, count(*)::int AS n FROM oauth_tokens WHERE gh_id = $1 AND kind IN ('access','refresh','household')"
        + " AND (expires IS NULL OR expires > extract(epoch FROM now())) GROUP BY kind ORDER BY kind", [ghId]);
      liveSignIns = { by_kind: Object.fromEntries(kinds.map((k) => [k.kind, k.n])) };
    } catch (e) {
      liveSignIns = { unavailable: why(e) };
    }
  }

  // bound to the source: yes when ANY read path says so; "unknown" when nothing says yes and a path could not be read
  const unreadable = Boolean(staticKeys.unavailable) || Boolean(liveSignIns.unavailable) || !pin;
  const yes = signIn.listed_in_source === true || (staticKeys.keys ?? []).some((k) => k.bound_to_source);
  return {
    handle,
    sign_in: signIn,
    static_keys: staticKeys,
    live_sign_in_keys: liveSignIns,
    harness_keys: { unavailable: "a key a meep's own harness holds (its env or its Letta secrets) is not in the store: not read, not reported" },
    bound_to_source: yes ? true : (unreadable ? "unknown" : false),
  };
}

// ── stamps ──────────────────────────────────────────────────────────────────

const mapJson = (m) => JSON.stringify([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The town's own folds over the clone's ledger, before and after `signed` lines are appended (in memory;
 * the clone is untouched). The move writes registry key lines and no movement, so every balance and every
 * staked total must come back equal: `unchanged` is that comparison across EVERY account, and the handle's
 * own numbers are named. `{ unavailable }` when the pinned engine cannot be read: that is not "unchanged".
 */
export async function stampsFold(clone, { signed = [], handle }) {
  try {
    const M = await importTownTool(clone, "stamp-mint.mjs");
    const text = readFileSync(join(clone, LEDGER), "utf8");
    const afterText = signed.length ? text.replace(/\s*$/, "\n") + signed.join("\n") + "\n" : text;
    const folds = (t) => { const e = M.parseStampLedger(t); return { balances: M.foldBalances(e), staked: M.foldStaked(e) }; };
    const b = folds(text);
    const a = folds(afterText);
    return {
      handle,
      balance: { before: b.balances.get(handle) ?? 0, after: a.balances.get(handle) ?? 0 },
      staked: { before: b.staked.get(handle) ?? 0, after: a.staked.get(handle) ?? 0 },
      unchanged: mapJson(b.balances) === mapJson(a.balances) && mapJson(b.staked) === mapJson(a.staked),
    };
  } catch (e) {
    return { unavailable: why(e) };
  }
}
