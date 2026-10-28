// bug-stage-guard.mjs — FIXED WAITS FOR THE MERGE, SHIPPED WAITS FOR THE TAG.
//
// Darko, 2026-10-28 ("Staff now, ship w45"). A stage's credit is paid on the
// advance and is irreversible (POS-649: the 10-15 mis-mint), and the Bug Catcher
// now runs the whole ladder, so a stage advanced ahead of its linked work is a
// mis-mint waiting to happen. bugs.mjs § FIXED WAITS FOR THE MERGE holds the
// law; this file reads GitHub and judges it, before the act is written:
//
//   to fixed    the linked pull request (links.fixed, on the advance's own
//               `link`) is MERGED. Open, a draft or closed unmerged: refused.
//   to shipped  the advance's `link` names a release tag, a commit or a
//               settlement tag on the SAME repo as the fix, the tag exists,
//               and it CONTAINS the fix's merge commit (GitHub's compare says
//               the merge is an ancestor of it: "ahead" or "identical").
//
// Every other stage, and a bug whose fixed rung was skipped (no fix to prove),
// pass untouched. NEVER PASS ON DOUBT: GitHub unreachable, rate-limited or
// answering something unreadable refuses with a 503 that says so, and nothing
// is written. The founders' door past a refusal is `force: "<why>"`
// (events-store.mjs § advanceBug), recorded on the act.
//
// The reads are made BEFORE the write's transaction opens, as bug-credit.mjs
// makes its own, so no store connection waits on the network (POS-370). They
// ride bug-credit.mjs § githubGet: the box's read-only token, the keyless
// retry on a refused token, the GITHUB_API_URL test override. A fixed advance
// reads one pull request; a shipped advance reads the fix's pull request, the
// tag's ref and one compare.

import { refuse } from "./events.mjs";
import { githubGet } from "./bug-credit.mjs";
import { STATE_FIXED, STATE_SHIPPED, earnedRef } from "./bugs.mjs";

const REPO = "([A-Za-z0-9_-][A-Za-z0-9._-]*)";
const TAG_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/releases/tag/([A-Za-z0-9._/-]+)$`);
const COMMIT_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/commit/([0-9a-fA-F]{7,40})$`);
const PULL_LINK_RE = new RegExp(`^https://github\\.com/postmark-town/${REPO}/pull/\\d+$`);

const SHIP_SHAPES = 'link: "https://github.com/postmark-town/<repo>/releases/tag/<tag>" (a release or settlement tag) or ".../commit/<sha>"';
const FORCE_NOTE = "wright or keemin can force it with a reason";

const refName = (r) => `${r.repo}#${r.number}`;
const segs = (name) => name.split("/").map(encodeURIComponent).join("/");

/** A ship link's shape: `{ kind: "tag" | "commit", repo, name }`, or a refusal. */
export function shipRefOf(link) {
  let m;
  if ((m = TAG_LINK_RE.exec(link))) {
    const name = m[2];
    if (name.includes("..") || name.includes("//") || name.startsWith("/") || name.endsWith("/"))
      throw refuse(422, `shipped's link is not a tag name the office can read`, SHIP_SHAPES, { field: "link" });
    return { kind: "tag", repo: m[1], name };
  }
  if ((m = COMMIT_LINK_RE.exec(link))) return { kind: "commit", repo: m[1], name: m[2].toLowerCase() };
  if (PULL_LINK_RE.test(link))
    throw refuse(422, "a pull request is the fix, not the ship", `shipped needs the ref that went live: ${SHIP_SHAPES}`, { field: "link" });
  throw refuse(422, "shipped's link is not one the office can read", SHIP_SHAPES, { field: "link" });
}

const cannot = (what) => refuse(503, `can't confirm ${what} right now: GitHub could not be read`,
  `nothing was written; ask again shortly, or ${FORCE_NOTE}`, { field: "link" });

/** The fix's pull request as GitHub holds it: `{ ref, merged, sha, open, draft }`; refuses when unreadable or absent. */
async function pullOf(ref, ctx, link) {
  const got = await githubGet(`/repos/postmark-town/${ref.repo}/pulls/${ref.number}`, ctx);
  if (!got) throw cannot(`the merge of ${refName(ref)}`);
  if (got.status === 404) throw refuse(422, `${link} is not on GitHub`, "fixed is earned by the fix: link its pull request, as GitHub shows it", { field: "link" });
  const b = got.body ?? {};
  return { ref, merged: b.merged === true, sha: typeof b.merge_commit_sha === "string" ? b.merge_commit_sha : null,
    open: b.state === "open", draft: b.draft === true };
}

/** Refuse a fix that is not merged, naming what it is instead. */
function mustBeMerged(p, stage) {
  if (p.merged && p.sha) return;
  if (p.merged) throw cannot(`${refName(p.ref)}'s merge commit`);
  const what = p.open ? (p.draft ? "an open draft" : "open") : "closed without merging";
  throw refuse(409, `${stage} waits for the PR to merge: ${refName(p.ref)} is ${what}`,
    p.open ? `advance again once ${refName(p.ref)} is merged; ${FORCE_NOTE}` : `link the pull request that fixed it; ${FORCE_NOTE}`, { field: "link" });
}

/**
 * Judge an advance against GitHub. `j` is judgeAdvance's answer, `prev` the
 * post as it stands. Returns null when the stage is not guarded (or has no fix
 * to prove), a small proof when it passes, and throws the refusal otherwise.
 */
export async function stageProofOf(j, prev, { env = process.env, fetchImpl = fetch } = {}) {
  const ctx = { env, fetchImpl };
  if (j?.to === STATE_FIXED) {
    // judgeEarnedLink already made j.earned a pull request link for this stage.
    const p = await pullOf(j.earned, ctx, j.link);
    mustBeMerged(p, "fixed");
    return { stage: STATE_FIXED, fix: refName(p.ref), sha: p.sha };
  }
  if (j?.to !== STATE_SHIPPED) return null;

  const fixLink = prev?.fields?.links?.fixed;
  if (!fixLink) return null;   // fixed was skipped, or came before links: no fix to prove
  const fix = earnedRef(String(fixLink));
  if (fix?.kind !== "pull")
    throw refuse(409, `the fix link on "${prev.id}" is not a pull request, so the office can't tell what shipped`, `fixed is earned by a pull request; ${FORCE_NOTE}`, { field: "link" });
  if (!j.link)
    throw refuse(422, `shipped needs the ref that carries ${refName(fix)}'s merge`, SHIP_SHAPES, { field: "link" });
  const ship = shipRefOf(j.link);
  if (ship.repo.toLowerCase() !== fix.repo.toLowerCase())
    throw refuse(422, `${j.link} is on ${ship.repo}, and the fix ${refName(fix)} is on ${fix.repo}`,
      `shipped links the tag or commit on ${fix.repo}, where the fix merged`, { field: "link" });

  const p = await pullOf(fix, ctx, fixLink);
  mustBeMerged(p, "shipped");
  const repo = `/repos/postmark-town/${fix.repo}`;
  if (ship.kind === "tag") {
    const ref = await githubGet(`${repo}/git/ref/tags/${segs(ship.name)}`, ctx);
    if (!ref) throw cannot(`that ${ship.name} exists`);
    if (ref.status === 404)
      throw refuse(409, `shipped waits for the tag: ${ship.name} is not a tag on ${fix.repo} yet`, `advance again once it is cut; ${FORCE_NOTE}`, { field: "link" });
  }
  const head = ship.kind === "tag" ? segs(ship.name) : ship.name;
  const cmp = await githubGet(`${repo}/compare/${p.sha}...${head}?per_page=1`, ctx);
  if (!cmp) throw cannot(`that ${ship.name} holds the merge`);
  if (cmp.status === 404)
    throw refuse(409, `shipped waits for the ${ship.kind === "tag" ? "tag" : "commit"}: ${ship.name} is not on ${fix.repo}`, `advance again once it is; ${FORCE_NOTE}`, { field: "link" });
  const status = cmp.body?.status;
  if (status !== "ahead" && status !== "identical") {
    if (status !== "behind" && status !== "diverged") throw cannot(`that ${ship.name} holds the merge`);
    throw refuse(409, `${ship.name} does not hold ${refName(fix)}'s merge (${p.sha.slice(0, 9)})`,
      `shipped waits for a ${ship.kind === "tag" ? "tag" : "commit"} cut after the merge; ${FORCE_NOTE}`, { field: "link" });
  }
  return { stage: STATE_SHIPPED, fix: refName(fix), sha: p.sha, ref: ship.name };
}
