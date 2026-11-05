// pos896-fixtures.mjs — independent expectations for the town-index twin suites (POS-896). TEST-ONLY.
//
// WHY. test/town-index-{quests,absent}.test.mjs hold the store's answers to the answers the retired office.db twin gave over
// one fixture town (test/golden/office-db-twins/*.json, recorded once; helpers/twin-golden.mjs). Those answers also carry
// data that is not the fixture's: the PINNED town's quest registry (its quests, its bounty postings) and one resident's
// published card. When the town pin moves, that data moves and the recorded answer no longer describes the input, although
// the store is right. This file is the narrow, named overlay that puts the PRISTINE input back into the expected side:
//
//   · the quest rows of an answer (`quests`, `quest_headroom`) follow the pristine registry FILE, in the file's order:
//     a row the record already holds is kept byte for byte (the stable legacy assertion), a row the record lacks is built
//     here from the registry row with explicit keys (never by the production board code), and a row the registry no longer
//     holds is dropped;
//   · the pot postings that have no pot file (`pots.invalid_rows.list`) are the registry's bounty ids that the fixture
//     store holds no pot for, in the file's order, in the wording the record already holds for such a posting;
//   · a resident card's two named fields are set from the pristine ADDRESS file's front matter.
//
// WHAT IT IS NOT. It never reads the answer under test (the "actual"), so it cannot agree with it by construction; it does
// not touch a field it does not name; it does not ignore anything. A shape it has no independent builder for throws by
// name instead of passing. The detectors in the suites hold the pristine expectation fixed and move the answer.
import assert from "node:assert/strict";

/** A registry row is a board posting unless it is a pot (`subtype: "bounty"`): src/queries.mjs § questBoardWith lifts those out. */
export const boardRowsOf = (rawQuests) => rawQuests.filter((q) => q.subtype !== "bounty");
export const bountyIdsOf = (rawQuests) => rawQuests.filter((q) => q.subtype === "bounty").map((q) => q.id);

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const RESIDENT_ROW_FIELDS = ["progress", "complete", "counted", "household"];

/** The registry fields a board row repeats, in the board's own key order, then `door` and (when the registry row has one) `awaits`. */
function registryFieldsOf(row) {
  const out = { id: row.id, title: row.title, cadence: row.cadence, validation: row.validation, target: row.target ?? null, reward: row.reward, source: row.source, door: null };
  if (row.awaits !== undefined) out.awaits = row.awaits;
  return out;
}

/**
 * The board row of a registry row the RECORD DOES NOT HOLD. Only the shape of an uncounted milestone (progress null: the daily
 * fold has no way to count it) is built; anything else throws, because inventing a counted row's progress would be inventing the
 * answer. `legacyRows` supplies the one resident-specific object (the household's size) from a legacy uncounted row in the same
 * answer; every other field is spelled out.
 */
function buildBoardRow(row, legacyRows, { resident }) {
  if (!(row.cadence === "milestone" && row.validation === "needs-review"))
    throw new Error(`pos896-fixtures: no independent expectation for registry quest "${row.id}" (cadence ${row.cadence}, validation ${row.validation}); extend the builder with its shape`);
  const out = { ...registryFieldsOf(row) };
  if (resident) {
    const peer = legacyRows.find((r) => r.measured === false && r.progress === null && isObj(r.household));
    assert.ok(peer, `pos896-fixtures: the record holds no uncounted row to take the household's size from, for "${row.id}"`);
    Object.assign(out, { progress: null, complete: null, counted: [], household: clone(peer.household) });
  }
  out.measured = false;
  return out;
}

/** `{ id, title, done, of, left, reward }` for an uncounted milestone, as the estate's quest headroom lists it. */
function buildHeadroomRow(row) {
  if (!(row.cadence === "milestone" && row.validation === "needs-review"))
    throw new Error(`pos896-fixtures: no independent headroom expectation for registry quest "${row.id}"`);
  return { id: row.id, title: row.title, done: null, of: row.target ?? null, left: null, reward: row.reward };
}

/** Follow the registry's order: keep the record's row by id, build the missing one, drop one the registry no longer holds. */
function followRegistry(legacy, boardRows, build) {
  const held = new Map(legacy.map((r) => [r.id, r]));
  return boardRows.map((row) => held.get(row.id) ?? build(row));
}

/** The record's posting rows (a registry bounty that has no pot file) and where they sit, or null when it holds none. */
function postingRowsOf(list, bountyIds) {
  const postings = list.filter((r) => isObj(r) && r.row_kind === "pot-posting" && bountyIds.includes(String(r.line ?? "").replace(/^quest-registry\.json § /, "")));
  return postings.length ? postings : null;
}

/**
 * The expected side for a quest-registry answer, as text. `expectedText` is the record's answer after `steady` (twin-golden.mjs);
 * `rawQuests` the pristine registry's `quests`; `fixturePotIds` the ids of the pots the fixture store holds a file for.
 * Returns the text with the quest lists and the posting rows following the registry, nothing else touched.
 */
export function overlayRegistry(expectedText, { rawQuests, fixturePotIds }) {
  let root;
  try { root = JSON.parse(expectedText); } catch { return expectedText; }
  const boardRows = boardRowsOf(rawQuests);
  const bountyIds = bountyIdsOf(rawQuests);
  const walk = (node, key, parentKey) => {
    if (Array.isArray(node)) {
      if (key === "quests" && node.every((r) => isObj(r) && typeof r.id === "string" && "cadence" in r) && node.length)
        return followRegistry(node, boardRows, (row) => buildBoardRow(row, node, { resident: node.some((r) => "household" in r) }));
      if (key === "quest_headroom" && node.every((r) => isObj(r) && typeof r.id === "string" && "of" in r) && node.length)
        return followRegistry(node, boardRows, buildHeadroomRow);
      if (key === "list" && parentKey === "invalid_rows") {
        const postings = postingRowsOf(node, bountyIds);
        if (!postings) return node.map((x) => walk(x, null, key));
        // the record's rows that are not registry postings keep their place and order; every posting sits after them (checked)
        const firstPosting = node.indexOf(postings[0]);
        assert.ok(node.slice(firstPosting).every((r) => postings.includes(r)), "pos896-fixtures: the record's posting rows do not sit at the end of its invalid rows");
        const template = postings[0];
        const templateId = String(template.line).replace(/^quest-registry\.json § /, "");
        const missing = bountyIds.filter((id) => !fixturePotIds.includes(id));
        const asRow = (id) => Object.fromEntries(Object.entries(template).map(([k, v]) => [k, typeof v === "string" ? v.split(templateId).join(id) : v]));
        return [...node.slice(0, firstPosting), ...missing.map(asRow)];
      }
      return node.map((x) => walk(x, null, key));
    }
    if (isObj(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k, key)]));
    return node;
  };
  return JSON.stringify(walk(root, null, null));
}

/**
 * The doorstep's `stakes` segment over an INVENTED world: its `rows` and its `count` are the given rows (written out by the
 * caller, in the segment's own key order and sort), and every other key of the segment stays the record's. The state the record
 * was made in is checked, not assumed: the record's segment must say it is unmeasured (`unavailable`) with every row's escrow
 * and at_risk null, since the expected rows carry null for both; a record in another state throws instead of being rewritten.
 */
export function overlayStakes(expectedText, { rows }) {
  let root;
  try { root = JSON.parse(expectedText); } catch { return expectedText; }
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObj(node)) return node;
    const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    if (isObj(out.stakes) && out.stakes.serves === "household.stakes" && Array.isArray(out.stakes.rows)) {
      assert.equal(typeof out.stakes.unavailable, "string", "pos896-fixtures: the record's stakes segment is measured, but the expected rows are the unmeasured state");
      assert.ok(out.stakes.rows.every((r) => r.escrow === null && r.at_risk === null), "pos896-fixtures: the record's rows are judged, but the expected rows are unjudged");
      out.stakes = { ...out.stakes, count: rows.length, rows: clone(rows) };
    }
    return out;
  };
  return JSON.stringify(walk(root));
}

/** One scalar of a markdown file's front matter (the first `---` block): `key: value` on one line, plain or quoted. Throws on a form it does not read. */
export function frontMatterScalar(text, key) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(m, "pos896-fixtures: no front matter");
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  assert.ok(line, `pos896-fixtures: no "${key}:" in the front matter`);
  let v = line.slice(key.length + 1).trim();
  assert.ok(v !== "" && !/^[|>]/.test(v), `pos896-fixtures: "${key}" is not a one-line scalar`);
  if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
  else if (/^".*"$/.test(v)) v = JSON.parse(v);
  return v;
}

/** Put `fields` (name → pristine value) on every `address.data` of an object whose `handle` is `handle`, wherever the answer nests it. */
export function overlayCard(expectedText, { handle, fields }) {
  let root;
  try { root = JSON.parse(expectedText); } catch { return expectedText; }
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObj(node)) return node;
    const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    if (out.handle === handle && isObj(out.address?.data)) {
      out.address = { ...out.address, data: { ...out.address.data } };
      for (const [k, v] of Object.entries(fields)) { assert.ok(k in out.address.data, `pos896-fixtures: the record's card for ${handle} has no "${k}"`); out.address.data[k] = v; }
    }
    return out;
  };
  return JSON.stringify(walk(root));
}

/** Where two JSON texts first part, as a path (for a detector to name the difference), or null when equal. */
export function firstDiffPath(a, b) {
  if (a === b) return null;
  let x, y;
  try { x = JSON.parse(a); y = JSON.parse(b); } catch { return "(not JSON)"; }
  const walk = (u, v, at) => {
    if (JSON.stringify(u) === JSON.stringify(v)) return null;
    if (!isObj(u) && !Array.isArray(u) || !isObj(v) && !Array.isArray(v) || Array.isArray(u) !== Array.isArray(v)) return at;
    if (Array.isArray(u)) {
      if (u.length !== v.length) return `${at}.length`;
      for (let i = 0; i < u.length; i += 1) { const d = walk(u[i], v[i], `${at}[${i}]`); if (d) return d; }
      return at;
    }
    const ku = Object.keys(u), kv = Object.keys(v);
    for (const k of new Set([...ku, ...kv])) { if (!(k in u) || !(k in v)) return `${at}.${k}`; const d = walk(u[k], v[k], `${at}.${k}`); if (d) return d; }
    return ku.join() === kv.join() ? at : `${at} (key order)`;
  };
  return walk(x, y, "$");
}
