// pos896-invented-world.mjs — an INVENTED world checkout for the doorstep's `stakes` segment (POS-896). TEST-ONLY.
//
// On import this builds a tiny git checkout in a fresh temp directory (INVENTED_WORLD: one branch, `main`, a few files) and
// removes it when the process exits. The office reads its world from `WORLD_CLONE`, a constant captured when src/world-store.mjs
// loads, so a process reads this world only if it is STARTED with WORLD_CLONE set to it: test/fixtures/pos896-doorstep-ask.mjs
// is that process for the two doorstep asks of town-index-residents. Nothing sets WORLD_CLONE in the test's own process, so every
// other ask of that file still reads the world it always read. The marks are made up; no resident's record is read or copied.
//
// WHAT THE SEGMENT READS FROM IT (src/doorstep-stakes.mjs § defaultWorld, defaultRegistry): the published marks
// (WORLD/world-state.json at the newest blessing, here main) and the sweep's registry (WORLD/settlement-publications.json at
// that ref). The doorstep's Mists block also reads the world (WORLD/skeleton.json) and its stances block the world's geometry
// (tools/geometry.mjs): the fixture gives each the least that leaves that block saying what it said over the pinned world. With
// the store holding no ingested town sha, escrow is unread, so no row is judged: `escrow` and `at_risk` are null and the
// segment says why. That state, and the segment's other sentences, stay the record's.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The marks of the invented world. `wright`'s four are the scope of the asks; the fifth is another owner's and must stay out. */
export const INVENTED_MARKS = [
  { id: "wright/alpha-bench", kind: "sited", by: "wright", household: "wright", body: "An invented bench, for a test.", at: { x: 10, y: 10 } },
  { id: "wright/bravo-parcel", kind: "parcel", by: "wright", household: "wright", body: "An invented parcel, for a test." },   // no place: the Mists forecast needs no parcel dial to read it
  { id: "wright/charlie-note", kind: "predicated", by: "wright", household: "wright", body: "An invented note, for a test." },
  { id: "wright/delta-lamp", kind: "sited", by: "wright", household: "wright", body: "An invented lamp the registry does not hold.", at: { x: 30, y: 30 } },
  { id: "someone-else/echo-gate", kind: "sited", by: "someone-else", household: "someone-else", body: "Another owner's invented gate.", at: { x: 40, y: 40 } },
];

/** The sweep's registry rows (delta-lamp is founding estate: no row, so its class reads null). */
export const INVENTED_REGISTRY = {
  "wright/alpha-bench": { household: "wright", path: "WORLD/marks/wright/alpha-bench/mark.md", class: "commons" },
  "wright/bravo-parcel": { household: "wright", path: "WORLD/marks/wright/bravo-parcel/mark.md", class: "home" },
  "wright/charlie-note": { household: "wright", path: "WORLD/marks/wright/charlie-note/mark.md", class: "commons" },
  "someone-else/echo-gate": { household: "someone-else", path: "WORLD/marks/someone-else/echo-gate/mark.md", class: "commons" },
};

/** What `wright`'s stakes rows must be over that world with escrow unread: sorted by id, no row judged, another owner's mark out. */
export const INVENTED_STAKE_ROWS = [
  { mark: "wright/alpha-bench", kind: "sited", body: "An invented bench, for a test.", class: "commons", escrow: null, at_risk: null },
  { mark: "wright/bravo-parcel", kind: "parcel", body: "An invented parcel, for a test.", class: "home", escrow: null, at_risk: null },
  { mark: "wright/charlie-note", kind: "predicated", body: "An invented note, for a test.", class: "commons", escrow: null, at_risk: null },
  { mark: "wright/delta-lamp", kind: "sited", body: "An invented lamp the registry does not hold.", class: null, escrow: null, at_risk: null },
];

const dir = mkdtempSync(join(tmpdir(), "pos896-invented-world-"));
export const INVENTED_WORLD = dir;
mkdirSync(join(dir, "WORLD"), { recursive: true });
writeFileSync(join(dir, "WORLD", "world-state.json"), JSON.stringify({ marks: INVENTED_MARKS }));
writeFileSync(join(dir, "WORLD", "settlement-publications.json"), JSON.stringify({ published: INVENTED_REGISTRY }));
// A readable skeleton that carries no `mists` is "no season" (src/mists-forecast.mjs § forecastMists), so the doorstep's Mists block
// stays absent as it is on a world whose marks no Mists reach. Without a skeleton the block would say it could not read one: a
// different answer in a branch that is not the stakes'.
writeFileSync(join(dir, "WORLD", "skeleton.json"), JSON.stringify({}));
// The doorstep's stances block asks the world for its own geometry (src/world-stance.mjs § stanceGeometry: `rect` and
// `overlapArea` from tools/geometry.mjs at main) before it reaches its own sentence about the missing credential. Without
// the module it says the geometry could not be read, a different answer in a branch that is not the stakes'. This is an
// invented axis-aligned stand-in for those two functions; no mark here overlaps another, so nothing depends on its arithmetic.
mkdirSync(join(dir, "tools"), { recursive: true });
writeFileSync(join(dir, "tools", "geometry.mjs"), [
  "export const rect = (m) => { const w = m?.extent?.w ?? 0, h = m?.extent?.h ?? 0, x = m?.at?.x ?? 0, y = m?.at?.y ?? 0; return { minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2 }; };",
  "export const overlapArea = (a, b) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));",
  "",
].join("\n"));
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=pos896", "-c", "user.email=pos896@postmark.test", "commit", "-qm", "an invented world");
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS clears temp */ } });
