#!/usr/bin/env node
// ship-guard.mjs — A PULL REQUEST INTO MAIN IS A SHIP OR A HOTFIX, AND A SHIP CARRIES MAIN.
//
// The law (blueprints documentation/OPERATIONS.md § Release Day; Darko,
// 2026-10-06): feature work merges into the open train (train/2026-wNN); main
// takes only the weekly ship (a train/* PR) and a mid-week fix carried to prod
// (a hotfix/* PR). The train takes main: before the ship PR merges, every
// commit main gained during the week (the hotfixes, the World pins) is merged
// into the train, so the tree that ships is the tree dev rehearsed.
//
// Why this is a check and not a sentence: after the w42 rollover (2026-10-06)
// five site PRs were opened against main instead of train/2026-w42, and two
// merged, skipping dev. The same day, three office hotfixes (w41.2–w41.5) sat
// on main without the train taking them, so Sunday's ship would have carried a
// tree nobody rehearsed. Both rules existed in prose. The precedent is
// tools/train-week-check.mjs, which refuses a train or tag named for a week
// that has not begun; this file is its sibling, run on every pull request by
// .github/workflows/ship-guard.yml.
//
//   node tools/ship-guard.mjs --base <ref> --head <ref> [--head-sha <sha>] [--main-ref origin/main] [--on YYYY-MM-DD]
//
// THE TWO RULES.
//   1. The base guard. A PR whose base is main fails unless its head branch is
//      train/* or hotfix/*. Whether a hotfix has Darko's word is a human
//      matter; this reads the branch name only.
//   2. The train contains main. A PR from train/* into main fails if main has
//      commits the train does not (`git rev-list --count <head>..<main>` > 0).
//
// Exit 0 = lawful. Exit 1 = refused, with the sentence that names the fix.
// Exit 2 = cannot run (usage, or git could not answer). Every non-zero exit
// fails the workflow step: a guard that cannot read is never a pass.
//
// It only reads. It never fetches, merges or pushes; the workflow fetches.

import { execFileSync } from "node:child_process";
import { releaseWeek, todayLocal } from "./train-week-check.mjs";

const strip = (ref) => String(ref ?? "").replace(/^refs\/heads\//, "");

/** The open train on a local date: train/<year>-w<current release week + 1> (train-week-check's arithmetic). */
export function openTrain(on = todayLocal()) {
  const cur = releaseWeek(on);
  return `train/${cur.year}-w${cur.week + 1}`;
}

/** Rule 1. Returns { ok, note } or { ok: false, defect, hint }. */
export function judgeBase({ base, head, on = todayLocal() }) {
  const b = strip(base), h = strip(head);
  if (b !== "main") return { ok: true, note: `base ${b} is not main — the base guard does not apply` };
  if (/^train\/./.test(h)) return { ok: true, note: `${h} into main is the weekly ship` };
  if (/^hotfix\/./.test(h)) return { ok: true, note: `${h} into main is a hotfix (Darko's word on it is a human matter, not this check's)` };
  const train = openTrain(on);
  return {
    ok: false,
    defect: `a pull request into main from ${h}: main takes only train/* (the weekly ship) and hotfix/* (a fix carried to prod mid-week)`,
    hint: `retarget to ${train} (gh pr edit <number> --base ${train}); work rides the open train and reaches main with the ship`,
  };
}

/** Rule 2. `missing` = main's commits the train lacks, as "<sha> <subject>" lines. */
export function judgeTrainContainsMain({ base, head, missing }) {
  const b = strip(base), h = strip(head);
  if (b !== "main" || !/^train\/./.test(h)) return { ok: true, note: `${h} into ${b} is not a ship PR — the train-contains-main rule does not apply` };
  if (!missing.length) return { ok: true, note: `${h} contains every commit on main` };
  const shown = missing.slice(0, 10).map((l) => `    ${l}`).join("\n");
  const more = missing.length > 10 ? `\n    … and ${missing.length - 10} more` : "";
  return {
    ok: false,
    defect: `${h} lacks ${missing.length} commit(s) that main has, so the ship would carry a tree dev never ran:\n${shown}${more}`,
    hint: `merge main into the train (git fetch origin && git checkout ${h} && git merge origin/main, then push); the train takes main before it ships`,
  };
}

/** main's commits that `headRev` lacks, oldest first: `git log --reverse <head>..<main>`. Throws if git cannot answer. */
export function mainCommitsMissing({ headRev, mainRef = "origin/main", cwd = process.cwd() }) {
  const out = execFileSync("git", ["log", "--reverse", "--format=%h %s", `${headRev}..${mainRef}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").filter(Boolean);
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}

const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/ship-guard.mjs");

if (isMain) {
  const args = process.argv.slice(2);
  const base = arg(args, "--base"), head = arg(args, "--head");
  if (!base || !head) {
    console.error("usage: node tools/ship-guard.mjs --base <ref> --head <ref> [--head-sha <sha>] [--main-ref origin/main] [--on YYYY-MM-DD]");
    process.exit(2);
  }
  const onArg = arg(args, "--on");
  const on = onArg ? new Date(`${onArg}T00:00:00Z`) : todayLocal();
  const verdicts = [judgeBase({ base, head, on })];
  let missing = [];
  if (strip(base) === "main" && /^train\/./.test(strip(head))) {
    try {
      missing = mainCommitsMissing({ headRev: arg(args, "--head-sha") ?? head, mainRef: arg(args, "--main-ref") ?? "origin/main" });
    } catch (e) {
      console.error(`CANNOT RUN · git could not list main's commits the train lacks: ${String(e.stderr || e.message).trim()}`);
      process.exit(2);
    }
  }
  verdicts.push(judgeTrainContainsMain({ base, head, missing }));
  let refused = 0;
  for (const v of verdicts) {
    if (v.ok) console.log(`OK · ${v.note}`);
    else { refused++; console.error(`REFUSED · ${v.defect}\n  ${v.hint}\n  (OPERATIONS.md § Release Day; tools/ship-guard.mjs)`); }
  }
  process.exit(refused ? 1 : 0);
}
