#!/usr/bin/env node
// release-train-gate.mjs — does this push to main come from the approved ship (STAR-102)?
//
// release-train.yml cut a release tag, and deployed it, for ANY push to main whose merge subject named a train. On
// 2026-11-02 at 21:10 EST GitHub's update-branch merged the train into main (a PR whose head was main, brought up to
// date with its base), its merge subject named the train, and w45.3 shipped early and had to be restored (daily 11-02
// § 21:xx). The subject says which train; it doesn't say whether the ship was approved.
//
// The approved ship is a pull request, train/<week> → main, merged by a person. So the tag is cut only when GitHub
// says this push's commit is the merge commit of such a PR: its head is the train the subject names, its base is
// main, it is merged, and whoever merged it is a User (a bot or an App merging the train is not the founder's
// approval). An update-branch push, a direct push and a merge subject that merely mentions a train all fail, and
// nothing is cut or deployed.
//
//   node tools/release-train-gate.mjs <sha> <week>      exit 0: the approved ship, cut; exit 1: not, say why; exit 2: unreadable
// Reads GITHUB_REPOSITORY and GH_TOKEN (the workflow's own token, pull-requests: read).

/**
 * The verdict, pure. `pulls` are the PRs GitHub associates with the commit, each with its `merged_by` read from the
 * PR itself (the commit-pulls list leaves it out). Returns { ok, why }.
 */
export function shipVerdict(pulls, sha, week) {
  const train = `train/${week}`;
  const ship = pulls.find((p) => p.merge_commit_sha === sha && p.base?.ref === "main" && p.head?.ref === train && p.merged_at);
  if (!ship) {
    const near = pulls.map((p) => `#${p.number} ${p.head?.ref} → ${p.base?.ref}${p.merged_at ? "" : " (unmerged)"}`).join(", ");
    return { ok: false, why: `${sha.slice(0, 9)} is not the merge commit of a ${train} → main pull request${near ? ` (it belongs to ${near})` : " (no pull request merged it: an update-branch or a direct push)"}` };
  }
  if (ship.merged_by?.type !== "User") return { ok: false, why: `#${ship.number} (${train} → main) was merged by ${ship.merged_by?.login ?? "nobody known"} (${ship.merged_by?.type ?? "?"}), not a person` };
  return { ok: true, why: `#${ship.number} (${train} → main), merged by ${ship.merged_by.login}` };
}

async function main([sha, week]) {
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN;
  if (!sha || !week || !repo || !token) { console.error("usage: GITHUB_REPOSITORY=… GH_TOKEN=… release-train-gate.mjs <sha> <week>"); return 2; }
  const get = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "release-train-gate" } });
    if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
    return r.json();
  };
  let pulls;
  try {
    pulls = await get(`commits/${sha}/pulls`);
    pulls = await Promise.all(pulls.map(async (p) => (p.merge_commit_sha === sha ? { ...p, merged_by: (await get(`pulls/${p.number}`)).merged_by } : p)));
  } catch (e) { console.error(`release-train-gate: GitHub unreadable (${e.message}); nothing is cut`); return 2; }
  const v = shipVerdict(pulls, sha, week);
  console.log(`release-train-gate: ${v.ok ? "the approved ship" : "not the approved ship"}: ${v.why}`);
  return v.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("release-train-gate.mjs")) process.exitCode = await main(process.argv.slice(2));
