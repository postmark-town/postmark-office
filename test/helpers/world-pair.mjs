// world-pair.mjs — ONE resolved World ref for a suite's fixture AND its engine (POS-1234, WLD-197).
//
// A fixture that reads WORLD/skeleton.json out of the clone's WORKING TREE while the engine's tools are materialized at the clone's
// BLESSED ref (the newest settlement tag, world-branches.mjs § blessed) reads two worlds the moment those refs differ: the engine's
// strict `regionAnchors` guard then refuses a skeleton that predates anchors. The guard is right; the fixture was reading the wrong ref.
// So the pair is resolved ONCE, here, and both halves come from that one ref: the skeleton by `git show <ref>:WORLD/skeleton.json`, the
// tools by materializeAtRef at the same <ref>. Nothing here names a sha: the ref is whatever the clone blesses.
import { execFileSync } from "node:child_process";

/** The skeleton document and the tools directory of `clone` at its one blessed ref (or at `ref`, when a test pins one). */
export async function resolveWorldPair(clone, { ref = null } = {}) {
  if (!clone) throw new Error("WORLD_CLONE is unset");
  const branches = await import("../../src/world-branches.mjs");
  const at = ref ?? branches.blessedRef(clone);
  const sha = execFileSync("git", ["-C", clone, "rev-parse", `${at}^{commit}`], { encoding: "utf8" }).trim();
  const text = execFileSync("git", ["-C", clone, "show", `${sha}:WORLD/skeleton.json`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ref: at, sha, skeleton: JSON.parse(text), toolsDir: branches.materializeAtRef(clone, sha, "tools") };
}

/** The skeleton as `law-ingest` stores it (one row per top-level key), for a fixture store's law rows. */
export const skeletonRowsOf = (doc) =>
  Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
