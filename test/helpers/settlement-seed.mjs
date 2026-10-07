// settlement-seed.mjs — two settlements, each naming a snapshot, in a test's
// store (POS-359): test/world-settlement.test.mjs and test/world-state-route.test.mjs.
//
// A parcel of ann's, bo's shed standing on it with its name continuing it (the
// subtree), and cy's bench and yard (a parcel) far away. S10 holds ann's parcel
// and the bench; S11 adds the yard, the shed and its name. The law sha is the
// office's world clone's HEAD, so the engine that folds them is the world's own.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marksDigestOf, snapshotDigestOf } from "../../src/world-snapshot.mjs";
import { resetSettlementCaches } from "../../src/world-settlement.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WORLD = join(ROOT, "world-clone");
export const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const LAW_SHA = git(WORLD, "rev-parse", "HEAD^{commit}");
export const TOWN_SHA = "a".repeat(40);
const SKELETON = JSON.parse(git(WORLD, "show", `${LAW_SHA}:WORLD/skeleton.json`));
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const box = (x, y, w, h) => ({ at: { x, y }, extent: { w, h } });
export const MARKS = {
  plot: { slug: "ann/plot", kind: "parcel", owner: "ann", body: "Ann's plot.", geometry: box(0, 0, 40, 40), parent: null, data: { date: "2026-09-01T00:00:00Z", tier: "market" } },
  bench: { slug: "cy/bench", kind: "sited", owner: "cy", body: "A bench.", geometry: box(300, 300, 4, 4), parent: null, data: { date: "2026-09-02T00:00:00Z", tier: "market" } },
  yard: { slug: "cy/yard", kind: "parcel", owner: "cy", body: "Cy's yard.", geometry: box(300, 340, 20, 20), parent: null, data: { date: "2026-09-03T00:00:00Z", tier: "market" } },
  shed: { slug: "bo/shed", kind: "sited", owner: "bo", body: "A shed.", geometry: box(5, 5, 4, 4), parent: null, data: { date: "2026-10-01T00:00:00Z", tier: "market" } },
  name: { slug: "bo/shed-name", kind: "naming", owner: "bo", body: "The Lean-To.", geometry: null, parent: "bo/shed", data: { date: "2026-10-01T00:00:01Z", tier: "market", name: "The Lean-To" } },
};
const rowText = (m) => JSON.stringify({ slug: m.slug, kind: m.kind, owner: m.owner, body: m.body, geometry: m.geometry, parent: m.parent, data: m.data });

/** The rig over one started store (embedded-store.mjs § startStore). */
export function settlementRig(store) {
  async function owner(fn) {
    const c = await store.connect("world2_owner");
    try { return await fn(c); } finally { await c.end(); }
  }
  async function asOffice(fn) {
    const c = await store.connect("office_api");
    try { return await fn(c); } finally { await c.end(); }
  }
  async function seal(c, { id, window, number, marks, lawSha = LAW_SHA }) {
    const pairs = marks.map((m) => ({ slug: m.slug, digest: sha256(rowText(m)), row: rowText(m) }));
    for (const p of pairs) await c.query("INSERT INTO mark_versions (digest, row) VALUES ($1, $2) ON CONFLICT DO NOTHING", [p.digest, p.row]);
    const marks_digest = marksDigestOf(pairs);
    for (const p of pairs) await c.query("INSERT INTO world_snapshot_marks (marks_digest, slug, digest) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [marks_digest, p.slug, p.digest]);
    const digest = snapshotDigestOf({ marks_digest, law_sha: lawSha, town_sha: TOWN_SHA, world_sha: null });
    await c.query(
      `INSERT INTO world_snapshots (id, window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, taken_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
      [id, window, digest, marks_digest, pairs.length, lawSha, TOWN_SHA, new Date(Date.UTC(2026, 9, 1 + id)).toISOString()]);
    await c.query(
      `INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at, snapshot_id)
       VALUES ($1, $2, $3, $4, $3, $5)`,
      [number, lawSha, new Date(Date.UTC(2026, 9, 1 + id, 1)).toISOString(), window, id]);
    return digest;
  }

  async function seed({ lawSha = LAW_SHA } = {}) {
    resetSettlementCaches();
    return owner(async (c) => {
      await c.query("TRUNCATE world_snapshot_folds, settlements, world_snapshots, world_snapshot_marks, mark_versions, law_projection, escrow_projection, acts, claims, windows CASCADE");
      for (const id of [500, 501]) {
        const opens = new Date(Date.UTC(2026, 9, 1, 6) + (id - 500) * 12 * 3600e3).toISOString();
        await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'closed', $2)", [id, opens]);
      }
      await c.query(
        `INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'class', 'LOGOS/classes/hall/mark.md', 'hall', '{"id":"the-town/hall","kind":"class","class":"hall"}')`, [lawSha]);
      for (const [key, data] of Object.entries(SKELETON))
        await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'skeleton', 'WORLD/skeleton.json', $2, $3)", [lawSha, key, JSON.stringify(data)]);
      // The ledger at TOWN_SHA has been ingested: ann backs her own plot.
      await c.query(
        "INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, 'ann/plot', 'ann', 'ann', 'ann', 1, 1)", [TOWN_SHA]);
      const s10 = await seal(c, { id: 1, window: 500, number: 10, marks: [MARKS.plot, MARKS.bench], lawSha });
      const s11 = await seal(c, { id: 2, window: 501, number: 11, marks: [MARKS.plot, MARKS.bench, MARKS.yard, MARKS.shed, MARKS.name], lawSha });
      return { s10, s11 };
    });
  }

  async function speak({ actor, on, stance, as = null, at = "2026-10-03T00:00:00Z" }) {
    await owner((c) => c.query(
      "INSERT INTO acts (at, actor, action, object, class, payload, household) VALUES ($1, $2, 'declare-stance-on', $3, 'stance', $4, $2)",
      [at, actor, on, JSON.stringify({ stance, ...(as ? { as } : {}) })]));
  }

  return { owner, asOffice, seal, seed, speak };
}
