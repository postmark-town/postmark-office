// pos896-invented-world.mjs — an INVENTED world checkout for the doorstep's `stakes` segment (POS-896). TEST-ONLY.
//
// IMPORT THIS FIRST. The office reads its world from `WORLD_CLONE`, a constant captured when src/world-store.mjs loads; a
// test file's imports are hoisted, so the only way to point an in-process read at another world is to set the variable in a
// module that is evaluated BEFORE the others. That is all this module does on import: it builds a tiny git checkout in a
// fresh temp directory (one branch, `main`, two files) and sets WORLD_CLONE to it. The directory is removed when the process
// exits. The marks are made up; no resident's record is read or copied.
//
// WHAT THE SEGMENT READS FROM IT (src/doorstep-stakes.mjs § defaultWorld, defaultRegistry): the published marks
// (WORLD/world-state.json at the newest blessing, here main) and the sweep's registry (WORLD/settlement-publications.json at
// that ref). With the store holding no ingested town sha, escrow is unread, so no row is judged: `escrow` and `at_risk`
// are null and the segment says why. That state, and the segment's other sentences, stay the record's.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The marks of the invented world. `wright`'s four are the scope of the asks; the fifth is another owner's and must stay out. */
export const INVENTED_MARKS = [
  { id: "wright/alpha-bench", kind: "sited", by: "wright", household: "wright", body: "An invented bench, for a test.", at: { x: 10, y: 10 } },
  { id: "wright/bravo-parcel", kind: "parcel", by: "wright", household: "wright", body: "An invented parcel, for a test.", at: { x: 20, y: 20 } },
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
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=pos896", "-c", "user.email=pos896@postmark.test", "commit", "-qm", "an invented world");
process.env.WORLD_CLONE = dir;
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS clears temp */ } });
