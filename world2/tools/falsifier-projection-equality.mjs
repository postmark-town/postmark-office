#!/usr/bin/env node
// falsifier-projection-equality.mjs — the standing guard on the repo→DB seam.
//
// THE LAW THIS ASSERTS (gold plan postmark-world-2.md § 3, anti-rebake rule 2,
// pen 3 — quoted verbatim, because falsifiers quote their law):
//
//   "Guards on the repo→DB seam (it is two-pens-shaped): RLS makes law_ingester
//    the only law-table writer; **a standing falsifier re-derives the projection
//    from repo HEAD and asserts equality (drift = red)**; registry row says
//    derived-from-repo."
//
// The sentence this file is: *a standing falsifier re-derives the projection from
// repo HEAD and asserts equality (drift = red).*
//
// ── WHY THIS EXISTS, IN THE PLAN'S OWN DIAGNOSIS ────────────────────────────
//
// The seam is "two-pens-shaped" — the class of bug that cost the town three hand
// repairs in a month (gold § 0: issue #2152, "the two-pens seam … now blocks
// settlements on every lively crossing"). Two writers to one truth, and no
// mechanism that could notice they had diverged. Here the repo is authoritative
// and the DB is a projection of it, so divergence has a decidable answer: derive
// it again and compare. Drift is red, and red is loud.
//
// ── WHAT IT CAN AND CANNOT CATCH (stated, so nobody trusts it further) ──────
//
// CATCHES  anything that moved a projection row without the pen: a hand UPDATE,
//          a partial or interrupted ingest, a row deleted, a stale head, a second
//          writer that RLS did not stop, a checkout ingested under the wrong sha.
//
// DOES NOT the derivation itself being wrong. This tool calls the SAME
// CATCH     `deriveLaw` / `deriveStamps` the ingester calls, deliberately — two
//           derivations would make an equality check a comparison of twins, and
//           a green would then mean only "both parsers agree", which is the
//           weaker claim. Parser correctness is the world's own lint's job.
//
// ── IT MUST BE ABLE TO FAIL ─────────────────────────────────────────────────
//
// The standing red-proof, which is a receipt and not a thought experiment
// (world2/tools/README.md § the red-proof carries the run):
//
//   psql … -c "UPDATE law_projection SET data = '{}'::jsonb
//              WHERE law_sha = '<head>' AND kind = 'class' AND key = 'resident'"
//   node world2/tools/falsifier-projection-equality.mjs --law-repo … # → exit 1
//   node world2/tools/law-ingest.mjs --law-repo … --sha <head>       # idempotent restore
//   node world2/tools/falsifier-projection-equality.mjs --law-repo … # → exit 0
//
// A run of this file that has never been shown going red is not a falsifier.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   PGHOST=… PGDATABASE=… PGUSER=… PGPASSWORD=… \
//     node world2/tools/falsifier-projection-equality.mjs \
//       --law-repo /tmp/world-at-head --town-repo /tmp/town-at-head
//
// Each checkout must be AT the sha `projection_heads` records for that repo —
// this pen never moves a checkout, and comparing against the wrong sha would
// prove nothing, so a mismatch exits 2 (cannot run) rather than 0 or 1.
//
// EXIT CODES:  0 equal (green) · 1 drift (RED) · 2 cannot run (caller/setup)

import { realpathSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { deriveLaw, headSha, LAW_REPO_KEY } from "./law-ingest.mjs";
import { deriveStamps, TOWN_REPO_KEY } from "./stamp-ingest.mjs";
import { deriveRoll } from "./roll-ingest.mjs";
import { liveHouseOfVia } from "../../src/household-deriver.mjs";
import { readPins } from "../../src/household-logins.mjs";

// Canonical JSON: keys sorted at every depth, so two structurally equal values
// have one spelling. Both sides are JS values by the time they get here — `pg`
// parses `jsonb` into objects — so this compares meaning, not the storage
// engine's key order, which jsonb does not preserve and must not be asked to.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

// SHOW THE DIVERGENCE, NOT THE PREFIX. A class row's `data` is a whole mark
// record — several kilobytes, most of it identical — so printing the first N
// characters of each side prints the same N characters twice and tells the
// reader nothing. (Observed: the red-proof's edited `pace_km_per_crossing`
// sat past the cut, and the two "differing" lines were byte-identical on
// screen.) This finds where the two spellings first part company and quotes a
// window around THAT, with the offset, so the finding names the field that
// moved rather than the object it moved inside.
function excerpt(a, b, width = 140) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 30);
  const cut = (s) => (from > 0 ? "…" : "") + s.slice(from, from + width) + (from + width < s.length ? "…" : "");
  return { at: i, a: cut(a), b: cut(b) };
}

// A diff that NAMES what moved. "drift = red" is only useful if the red says
// which row — an alarm that means "something, somewhere" is an alarm people
// learn to silence.
function diffKeyed(expected, actual, { label, idOf, fieldsOf }) {
  const exp = new Map(expected.map((r) => [idOf(r), r]));
  const act = new Map(actual.map((r) => [idOf(r), r]));
  const findings = [];
  for (const [id, e] of exp) {
    const a = act.get(id);
    if (!a) { findings.push(`${label} MISSING in DB: ${id}`); continue; }
    const ef = fieldsOf(e), af = fieldsOf(a);
    for (const k of Object.keys(ef)) {
      const ec = canonical(ef[k]), ac = canonical(af[k]);
      if (ec !== ac) {
        const x = excerpt(ec, ac);
        findings.push(`${label} DIFFERS at ${id} · field ${k} · first divergence at char ${x.at}\n    repo says: ${x.a}\n    DB says:   ${x.b}`);
      }
    }
  }
  for (const id of act.keys()) if (!exp.has(id)) findings.push(`${label} EXTRA in DB (repo derives no such row): ${id}`);
  return findings;
}

async function headOf(client, repo) {
  const { rows } = await client.query("SELECT sha, ingested_at FROM projection_heads WHERE repo = $1", [repo]);
  return rows[0] ?? null;
}

/** The law lane: law_projection rows at the head sha, plus the current identities. */
async function checkLaw(client, lawRepo) {
  const head = await headOf(client, LAW_REPO_KEY);
  if (!head) return { lane: LAW_REPO_KEY, status: "no-head", findings: [`projection_heads has no '${LAW_REPO_KEY}' row — nothing has been ingested, so there is nothing to hold to the repo`] };

  const at = headSha(lawRepo);
  if (at !== head.sha) {
    return { lane: LAW_REPO_KEY, status: "cannot-run", findings: [
      `checkout ${lawRepo} is at ${at}; projection_heads['${LAW_REPO_KEY}'] says ${head.sha}. ` +
      `This pen never moves a checkout — put it at the recorded sha. Comparing against a different sha would prove nothing.`] };
  }

  // `identities` is no longer the law pen's (055, POS-350): it is a VIEW over the
  // store's registry, so there is nothing of it to hold to the law repo.
  const { rows: derived } = await deriveLaw({ lawRepo });
  const db = (await client.query(
    "SELECT kind, path, key, data FROM law_projection WHERE law_sha = $1", [head.sha])).rows;

  const findings = [
    ...diffKeyed(derived, db, {
      label: "law_projection", idOf: (r) => `${r.kind}/${r.key}`,
      fieldsOf: (r) => ({ path: r.path, data: r.data }),
    }),
  ];
  return { lane: LAW_REPO_KEY, status: findings.length ? "drift" : "equal", sha: head.sha,
    counts: { derived: derived.length, db: db.length }, findings };
}

/**
 * The town lane: BOTH town projections at the head sha — `stamp_projection` and
 * `town_roll` — because one pen writes them in one transaction against one head
 * (stamp-ingest.mjs § THE TOWN'S SECOND PROJECTION). Checking one and not the
 * other would leave the guard covering half of what the head promises.
 *
 * The roll also carries the one CROSS-PROJECTION invariant this store has, and
 * it is here rather than in a lane of its own because this is the only tool that
 * holds both sides at their recorded shas.
 */
async function checkStamps(client, townRepo) {
  const head = await headOf(client, TOWN_REPO_KEY);
  if (!head) return { lane: TOWN_REPO_KEY, status: "no-head", findings: [`projection_heads has no '${TOWN_REPO_KEY}' row — nothing has been ingested, so there is nothing to hold to the repo`] };

  const at = headSha(townRepo);
  if (at !== head.sha) {
    return { lane: TOWN_REPO_KEY, status: "cannot-run", findings: [
      `checkout ${townRepo} is at ${at}; projection_heads['${TOWN_REPO_KEY}'] says ${head.sha}. Put it at the recorded sha.`] };
  }

  // The pen re-keys the town's spellings to the house (stamp-ingest § writeStamps,
  // POS-457); the derivation is held to the row through the same re-key.
  const houseOf = await liveHouseOfVia(client);
  const derived = (await deriveStamps({ townRepo })).rows
    .map((r) => ({ ...r, household: r.household == null ? null : houseOf(r.household) }));
  const db = (await client.query(
    "SELECT handle, household, balance FROM stamp_projection WHERE town_sha = $1", [head.sha])).rows;

  const { rows: rollDerived } = await deriveRoll({ townRepo });
  const rollDb = (await client.query(
    "SELECT handle, data FROM town_roll WHERE town_sha = $1", [head.sha])).rows;

  const findings = [
    ...diffKeyed(derived, db, {
      label: "stamp_projection", idOf: (r) => r.handle,
      fieldsOf: (r) => ({ household: r.household, balance: Number(r.balance) }),
    }),
    ...diffKeyed(rollDerived, rollDb, {
      label: "town_roll", idOf: (r) => r.handle, fieldsOf: (r) => ({ data: r.data }),
    }),
  ];

  // ── THE INVARIANT: identities ⊆ town_roll ─────────────────────────────────
  //
  // EVERY WORLD IDENTITY IS A TOWN RESIDENT. `identities` has been a VIEW over the
  // household registry since 055 (`households` + `household_pins`, live in the store),
  // read here AS OF THE HEAD through this town checkout's own registry files (see
  // `checkIdentities`); `town_roll` is who the town's own WHITE_PAGES
  // admits. A handle in the first and not the second is a world that has granted
  // standing to somebody the town has never heard of — which is what the
  // `dylan-android-husband` alias was until it was stripped from world main at
  // `559301d4` (2026-08-29). It is not the same shape as the reverse: the town
  // is the wider list BY DESIGN (that is this whole ruling), and a resident with
  // no world household is simply someone who has not been grouped yet.
  //
  // One line, because it is one sentence of law and it can fail: put any handle
  // into the head's households.json (or github-ids.json) that WHITE_PAGES does not
  // carry and this reds.
  //
  // A CANONICAL RENAME IS THE SAME RESIDENT (POS-975). The registry keeps a renamed
  // resident's old key on purpose, retired, with `renamed_to` and the same GitHub
  // id as the new one (055 keeps a retired handle in its house; town `880390274`,
  // "old handle kept"), so `identities` still names it and WHITE_PAGES does not.
  // Such a handle is let through only on the town's own pins, read from THIS
  // checkout (the sha the roll was derived at), and only when the new handle is
  // in the roll: see `identitiesOutsideTheRoll`.
  //
  // LIKE WITH LIKE (POS-975, part 2). `identities` is a view over the LIVE registry
  // (055): a resident admitted after the last settlement is in it at once, while the
  // roll is read at the town head, which moves only at a settlement. So the identities
  // are taken AS OF THE HEAD: only those this same checkout's registry files name
  // (see `checkIdentities`). The rest are said in a note, never a finding. A store
  // identity those files never got (a drain that did not land) is, by the same rule,
  // `registry-drain --check`'s to catch and not this check's: it cannot be told here
  // from a late admission.
  const rollHandles = new Set(rollDerived.map((r) => r.handle));
  const idv = await checkIdentities(client, rollHandles, townRepo);
  if (idv.unreadable) {
    return { lane: TOWN_REPO_KEY, status: "cannot-run", findings: [idv.unreadable] };
  }
  const { orphans, renamed, postdate } = idv;
  if (orphans.length) {
    findings.push(`identities ⊄ town_roll: ${orphans.length} world identit${orphans.length === 1 ? "y is" : "ies are"} not in the town's roll ` +
      `(${orphans.join(", ")}) — every world identity is a town resident; the world cannot grant standing to a handle WHITE_PAGES does not carry`);
  }

  return { lane: TOWN_REPO_KEY, status: findings.length ? "drift" : "equal", sha: head.sha,
    counts: { derived: derived.length, db: db.length, roll_derived: rollDerived.length, roll_db: rollDb.length,
              identities_outside_the_roll: orphans.length, identities_renamed_in_the_roll: renamed.length,
              identities_after_the_head: postdate.length },
    findings, notes: [
      ...renamed.map((r) => `renamed: ${r.handle} → ${r.renamed_to} (one GitHub id, ${r.id}; retired ${r.retired}), per this town checkout's tools/github-ids.json`),
      ...(postdate.length ? [`${postdate.length} identit${postdate.length === 1 ? "y" : "ies"} postdate the town head or were never drained: ${postdate.join(", ")} (this checkout's registry files do not name ${postdate.length === 1 ? "it" : "them"}; not a finding)`] : []),
    ] };
}

/**
 * The world identities of the STORE, taken as of the town head, held to the roll (POS-975).
 * Reads `identities` (the registry view, live) from `client`, and the registry AS OF THE
 * HEAD from `townRepo`, the checkout `checkStamps` has already proved is at the recorded
 * sha: `tools/households.json` residents and `tools/github-ids.json` keys. A store identity
 * that neither file names is `postdate` (admitted after the head, or never drained), and
 * is not judged; the rest go through `identitiesOutsideTheRoll`. Either file unreadable
 * answers `unreadable`, never an empty set, so a checkout that cannot say what the head
 * held cannot turn every identity into a quiet `postdate`.
 */
export async function checkIdentities(client, rollHandles, townRepo) {
  const named = registryNamesAtHead(townRepo);
  if (named.unreadable) return { orphans: [], renamed: [], postdate: [], unreadable: named.unreadable };
  const handles = (await client.query("SELECT handle FROM identities ORDER BY handle")).rows.map((r) => r.handle);
  const asOfTheHead = handles.filter((h) => named.set.has(h));
  const postdate = handles.filter((h) => !named.set.has(h));
  return { ...identitiesOutsideTheRoll(asOfTheHead, rollHandles, readPins(townRepo)), postdate, unreadable: null };
}

/** Every handle the town checkout's own registry files name: households.json residents plus github-ids.json keys. */
function registryNamesAtHead(townRepo) {
  const set = new Set();
  let houses, pins;
  try { houses = JSON.parse(readFileSync(join(townRepo, "tools", "households.json"), "utf8")).households; }
  catch (e) { return { unreadable: `checkout ${townRepo} has no readable tools/households.json (${e.code ?? e.message}): cannot say which identities the town head held` }; }
  try { pins = JSON.parse(readFileSync(join(townRepo, "tools", "github-ids.json"), "utf8")); }
  catch (e) { return { unreadable: `checkout ${townRepo} has no readable tools/github-ids.json (${e.code ?? e.message}): cannot say which identities the town head held` }; }
  if (!houses || typeof houses !== "object" || !pins || typeof pins !== "object") {
    return { unreadable: `checkout ${townRepo}: tools/households.json or tools/github-ids.json is not the expected shape` };
  }
  for (const h of Object.values(houses)) for (const r of Array.isArray(h?.residents) ? h.residents : []) set.add(r);
  for (const k of Object.keys(pins)) set.add(k);
  return { set };
}

/**
 * The world identities the town's roll does not carry, with the canonical renames
 * set apart (POS-975). PURE: `handles` are `identities.handle`, `rollHandles` the
 * roll derived at the town head, `pins` that SAME checkout's tools/github-ids.json.
 *
 * A handle outside the roll is a rename, not an orphan, only when the pins say so
 * in full: its own entry is `retired` with a `renamed_to`; that new handle's entry
 * is not retired and carries the same GitHub `id`; and the new handle is in the
 * roll. Anything less (no pins, a retirement with no successor, a successor that
 * is missing, retired, another account or not in the roll) stays an orphan, RED.
 * One hop only: a rename of a rename is not followed, so it reads RED, not green.
 */
export function identitiesOutsideTheRoll(handles, rollHandles, pins) {
  const pinOf = (h) => (pins && typeof pins === "object" && Object.hasOwn(pins, h) && pins[h] && typeof pins[h] === "object" ? pins[h] : null);
  const orphans = [], renamed = [];
  for (const handle of handles) {
    if (rollHandles.has(handle)) continue;
    const old = pinOf(handle);
    const to = typeof old?.renamed_to === "string" ? old.renamed_to : null;
    const next = to ? pinOf(to) : null;
    const sameAccount = next && old.id != null && next.id === old.id;
    if (old?.retired && next && !next.retired && sameAccount && rollHandles.has(to)) {
      renamed.push({ handle, renamed_to: to, id: old.id, retired: old.retired });
    } else orphans.push(handle);
  }
  return { orphans, renamed };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const lawRepo = argOf("--law-repo");
  const townRepo = argOf("--town-repo");
  if (!lawRepo && !townRepo) {
    console.error("usage: falsifier-projection-equality.mjs [--law-repo <checkout>] [--town-repo <checkout>]\n" +
      "each checkout must be at the sha projection_heads records for it.");
    process.exit(2);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  let results;
  try {
    results = [];
    if (lawRepo) results.push(await checkLaw(client, lawRepo));
    if (townRepo) results.push(await checkStamps(client, townRepo));
  } finally { await client.end(); }

  let red = false, cannotRun = false;
  for (const r of results) {
    if (r.status === "equal") {
      console.log(`GREEN · ${r.lane} @ ${r.sha} — projection equals repo (${JSON.stringify(r.counts)})`);
    } else if (r.status === "drift") {
      red = true;
      console.log(`RED · ${r.lane} @ ${r.sha} — ${r.findings.length} drift finding(s) (${JSON.stringify(r.counts)})`);
      for (const f of r.findings) console.log(`  - ${f}`);
    } else {
      cannotRun = true;
      console.log(`CANNOT RUN · ${r.lane}`);
      for (const f of r.findings) console.log(`  - ${f}`);
    }
    // what was let through is said, green or red, so nobody has to trust a quiet pass
    for (const n of r.notes ?? []) console.log(`  · ${n}`);
  }

  // A falsifier that could not compare anything must not report green. Silence
  // is not equality — "a silent fallback is indistinguishable from success" is
  // the exact failure the world's own class reader was rewritten to avoid.
  if (red) process.exit(1);
  if (cannotRun || results.length === 0) process.exit(2);
  process.exit(0);
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
