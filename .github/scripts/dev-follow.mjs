// dev-follow.mjs — the runner's half of .github/workflows/dev-follow.yml (POS-1256): read the
// event, the trains, dev's release.json and the holder PR; decide (dev-follow-lib.mjs); write the
// plan, the receipt, and the notices. It reads GitHub and git; it never reaches the box (the
// workflow's ssh steps do, and say so by name).
//
//   node .github/scripts/dev-follow.mjs plan    --event-name <n> --event-path <f> --repo <o/r> --box <release.json> --out <plan.json>
//   node .github/scripts/dev-follow.mjs receipt --plan <plan.json> --run <url> --out <stage/release.json>
//   node .github/scripts/dev-follow.mjs notify  --plan <plan.json> --repo <o/r> --when now|after-carry
//
// The environment, from the runner: GH_TOKEN (gh's), GITHUB_OUTPUT and GITHUB_STEP_SUMMARY.
// `DEV_FOLLOW_GH` names a script run instead of `gh`, for the test that drives this end to end.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LABEL, buildReceipt, decide, devBoxStepsChanged, short } from "./dev-follow-lib.mjs";

const MARKER = "<!-- dev-preview-holder -->";
const SAFE_TAG = /^(train\/\d{4}-w\d{1,2}[a-z]?|pr\/\d+)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

function gh(argv, { input } = {}) {
  const stub = process.env.DEV_FOLLOW_GH;
  const [cmd, cmdArgs] = stub ? [process.execPath, [stub, ...argv]] : ["gh", argv];
  return execFileSync(cmd, cmdArgs, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
const ghJson = (argv) => JSON.parse(gh(argv));
const git = (dir, argv) => execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (dir, argv) => spawnSync("git", ["-C", dir, ...argv], { stdio: "ignore" }).status === 0;

/** Make a commit present locally, fetching it by sha from origin when it is not. Returns the full sha or null. */
function resolveCommit(dir, ref) {
  const rev = (r) => spawnSync("git", ["-C", dir, "rev-parse", "-q", "--verify", `${r}^{commit}`], { encoding: "utf8" });
  let r = rev(ref);
  if (r.status !== 0 && /^[0-9a-f]{7,40}$/.test(ref)) {
    gitOk(dir, ["fetch", "-q", "origin", ref]);
    r = rev(ref);
    if (r.status !== 0) { gitOk(dir, ["fetch", "-q", "origin", "+refs/pull/*/head:refs/remotes/origin/pr/*"]); r = rev(ref); }
  }
  return r.status === 0 ? r.stdout.trim() : null;
}

function deployMd(dir, sha) {
  const r = spawnSync("git", ["-C", dir, "show", `${sha}:deploy/DEPLOY.md`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function readEvent(name, path) {
  const p = JSON.parse(readFileSync(path, "utf8"));
  if (name === "push") return { kind: "push", branch: String(p.ref ?? "").replace(/^refs\/heads\//, "") };
  const pr = p.pull_request;
  return {
    kind: "pr", action: p.action, labelName: p.label?.name ?? null, sender: p.sender?.login ?? "unknown",
    pr: {
      number: pr.number, state: pr.state, headSha: pr.head.sha, headRepo: pr.head.repo?.full_name ?? null,
      labels: (pr.labels ?? []).map((l) => l.name),
    },
  };
}

function plan(o) {
  const dir = o["git-dir"] ?? ".";
  const repo = o.repo;
  const now = o.now ?? new Date().toISOString();
  const event = readEvent(o["event-name"], o["event-path"]);

  // The trains, as origin has them now (a push since the checkout counts).
  const trainHeads = {};
  for (const line of git(dir, ["ls-remote", "--heads", "origin", "refs/heads/train/*"]).split("\n").filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    trainHeads[ref.replace(/^refs\/heads\//, "")] = sha;
  }

  // What dev runs, as the workflow read it off the box (an empty or absent file is "unreadable").
  let box = { readable: false };
  if (o.box && existsSync(o.box)) {
    try {
      const r = JSON.parse(readFileSync(o.box, "utf8"));
      if (r && typeof r.tag === "string" && typeof r.sha === "string") box = { readable: true, tag: r.tag, sha: r.sha, holder: r.holder ?? null };
    } catch { /* unreadable stays unreadable */ }
  }

  let holderPr = null;
  if (box.readable && box.holder?.pr) {
    try {
      const p = ghJson(["api", `repos/${repo}/pulls/${box.holder.pr}`]);
      holderPr = { number: p.number, state: p.state, headRepo: p.head?.repo?.full_name ?? null, headSha: p.head?.sha, labels: (p.labels ?? []).map((l) => l.name) };
    } catch { holderPr = null; }
  }
  let labelerPermission = null;
  if (event.kind === "pr" && event.action === "labeled" && event.labelName === LABEL) {
    try { labelerPermission = ghJson(["api", `repos/${repo}/collaborators/${event.sender}/permission`]).permission ?? null; } catch { labelerPermission = null; }
  }

  const stepsChanged = (baseline, target) => {
    const from = resolveCommit(dir, baseline);
    const to = resolveCommit(dir, target);
    if (!from) return { changed: true, sections: [], error: `dev's carried commit ${short(baseline)} is not in this repository's history here` };
    if (!to) return { changed: true, sections: [], error: `the commit to carry, ${short(target)}, could not be read` };
    return devBoxStepsChanged(deployMd(dir, from), deployMd(dir, to));
  };

  // A PR's head must be a commit this checkout can archive.
  const result = decide({ event, repo, trains: Object.keys(trainHeads), trainHeads, box, holderPr, labelerPermission, stepsChanged, now });
  if (result.target) {
    const full = resolveCommit(dir, result.target.sha);
    if (!full) throw new Error(`cannot read ${result.target.sha} to carry it`);
    result.target.sha = full;
    if (!SAFE_TAG.test(result.target.tag) || !FULL_SHA.test(full)) throw new Error(`refusing an unexpected target ${result.target.tag} ${full}`);
    if (result.holder) result.holder.sha = full;
  }
  return { event, box, result, now };
}

function writeOutputs(p, o) {
  const { result } = p;
  const lines = [
    `status=${result.status}`,
    `carry=${result.status === "carry"}`,
    `tag=${result.target?.tag ?? ""}`,
    `sha=${result.target?.sha ?? ""}`,
    `notices=${result.notices.length > 0 || result.unlabel.length > 0}`,
  ];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  const summary = [`## Dev office: ${result.status}`, "", result.reason, ""];
  if (result.target) summary.push(`- target: \`${result.target.tag}\` at \`${result.target.sha}\``);
  if (result.holder) summary.push(`- holder: PR #${result.holder.pr}, labelled by ${result.holder.by}`);
  summary.push(`- dev runs now: ${p.box.readable ? `\`${p.box.tag}\` at \`${short(p.box.sha)}\`${p.box.holder ? `, held by PR #${p.box.holder.pr}` : ""}` : "unreadable"}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  if (result.status === "wait") console.log(`::warning::${result.reason}`);
  console.log(`${result.status}: ${result.reason}`);
  writeFileSync(o.out, JSON.stringify({ ...result, box: p.box }, null, 2) + "\n");
}

function receipt(o) {
  const p = JSON.parse(readFileSync(o.plan, "utf8"));
  if (p.status !== "carry") throw new Error("the plan carries nothing");
  const r = buildReceipt({ tag: p.target.tag, sha: p.target.sha, runUrl: o.run, holder: p.holder, now: new Date().toISOString() });
  writeFileSync(o.out, JSON.stringify(r, null, 2) + "\n");
  console.log(JSON.stringify(r, null, 2));
}

function upsertPrComment(repo, number, body) {
  const text = `${MARKER}\n${body}`;
  let found = null;
  try {
    for (const c of ghJson(["api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--slurp"]).flat()) {
      if (typeof c.body === "string" && c.body.startsWith(MARKER) && c.user?.type === "Bot") found = c;
    }
  } catch { /* no list, then a new comment */ }
  if (found) gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${found.id}`, "--input", "-"], { input: JSON.stringify({ body: text }) });
  else gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "--input", "-"], { input: JSON.stringify({ body: text }) });
}

function notify(o) {
  const p = JSON.parse(readFileSync(o.plan, "utf8"));
  const when = o.when;
  for (const n of p.notices.filter((x) => x.when === when)) {
    if (n.to === "pr") upsertPrComment(o.repo, n.number, n.body);
    else {
      let pulls = [];
      try { pulls = ghJson(["api", `repos/${o.repo}/commits/${n.sha}/pulls`]).map((x) => x.number); } catch { /* the run summary still says it */ }
      for (const number of pulls.slice(0, 3)) gh(["api", "-X", "POST", `repos/${o.repo}/issues/${number}/comments`, "--input", "-"], { input: JSON.stringify({ body: n.body }) });
    }
  }
  if (when === "now") {
    for (const number of p.unlabel) {
      try { gh(["api", "-X", "DELETE", `repos/${o.repo}/issues/${number}/labels/${LABEL}`]); } catch (err) { console.log(`::warning::could not remove ${LABEL} from #${number}: ${String(err.message).split("\n")[0]}`); }
    }
  }
}

// An entry guard that survives a junction (the realpath compare, as test/cli-guard.test.mjs names it).
const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  try {
    if (cmd === "plan") writeOutputs(plan(o), o);
    else if (cmd === "receipt") receipt(o);
    else if (cmd === "notify") notify(o);
    else { console.error("usage: dev-follow.mjs plan|receipt|notify (see the header)"); process.exitCode = 2; }
  } catch (err) {
    console.error(`dev-follow ${cmd}: ${err.message}`);
    process.exitCode = 1;
  }
}
