// makers-law.mjs — a test's class layer that states `makers` (LOGOS v2, lane O1).
//
// The leave door asks the class's own `makers` now (holding-law § makersOf), and
// an unread makers answers false (G2: no floor). A test that drives the door
// with no store and no law therefore needs a class layer that says who may
// make what — the ruled roots, as a law snapshot: the root false, thing, note,
// post-era idea and bounty true (classes.md § makers, ruled 16:02 / 18:44).
//
//   import { seedMakersLaw } from "./helpers/makers-law.mjs";
//   await seedMakersLaw();            // after the office modules are imported
//   test.after(() => resetLawSnapshot());

const SHA = "e".repeat(40);
const row = (key, data) => ({ number: 260, tag_sha: SHA, newest: 260, kind: "class", key, data: { class: key, ...data } });

/** The ruled roots, and the classes the door tests cite. Extra rows ride after them. */
export const MAKERS_ROWS = Object.freeze([
  row("postmark-node", { dials: { makers: false } }),
  row("mark", { extends: "postmark-node" }),
  row("thing", { extends: "mark", dials: { makers: true } }),
  row("note", { extends: "mark", dials: { makers: true } }),
  row("bounty", { extends: "mark", dials: { makers: true } }),
  row("idea", { extends: "mark", dials: { makers: true } }),
]);

export async function seedMakersLaw(extra = []) {
  const { reloadLawSnapshot, LAW_REFRESH_SQLS } = await import("../../src/law-snapshot.mjs");
  const rows = [...MAKERS_ROWS, ...extra];
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 260, pinned: 260 }] : rows }) });
  return rows;
}
