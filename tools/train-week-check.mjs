#!/usr/bin/env node
// train-week-check.mjs — A TRAIN IS A WEEK'S SHIP, NAMED FOR THE WEEK IT SHIPS IN.
//
// The law (postmark-telemetry docs/SHIPPING.md § 2, founder-ruled
// 2026-08-31): release day is SUNDAY, the first day of the release week —
// `train/2026-w37` is the train that ships Sunday 2026-09-06, and
// `train/2026-w(NN+1)` opens THAT day, after w(NN) ships. Extra work during the
// week lands on the open train. A prod ship cut off main mid-week is a patch
// tag of the CURRENT release week (`release/2026-w36.15`), never the next.
//
// Why this is a check and not a sentence: on 2026-09-03 (a Thursday in release
// week 36) the w37 train was merged to main four days early, `release/2026-w37`
// was cut, and a `train/2026-w38` was proposed for the next lane — the founder:
// "it's bothering me that we're on w38 when it's still w36 … I already said
// this before." A rule in a file is coverage; a rule the work must pass through
// is enforcement. This runs in the release workflows and the hand-carry recipe.
//
//   node tools/train-week-check.mjs <ref>            e.g. train/2026-w37 · release/2026-w36.15 · refs/heads/train/2026-w37
//   node tools/train-week-check.mjs <ref> --on 2026-09-03   (the date to judge against; default today, America/New_York)
//   node tools/train-week-check.mjs --self-test        (the check can fail: every rule flipped red once)
//   node tools/train-week-check.mjs --tag-for train/2026-w38   (prints the lawful tag BASE for shipping that train TODAY: release/2026-w37 on a Tuesday of week 37, release/2026-w38 on its Sunday; exit 1 if no lawful tag exists)
//
// Exit 0 = lawful. Exit 1 = refused, with the sentence that names the fix.
// Exit 0 with a WARN line = flexed by the founder's word (the FLEXED table).
//
// THE WEEK ARITHMETIC. A release week starts Sunday. Its number is the ISO week
// of the Monday inside it — so Sunday 2026-09-06 begins release week 37 (ISO
// week of Monday 09-07 = 37), and Thursday 2026-09-03 sits in release week 36.
// `currentWeek(date)` = the release week the date is in; the OPEN train is
// `currentWeek + 1`; a mid-week tag is `currentWeek.N`; on release day (Sunday)
// the train `currentWeek` ships and its tag is `release/2026-w<currentWeek>`.

const FLEXED = Object.freeze({
  // founder, 2026-09-03, on the early w37 merge + tag: "37 is fine for now."
  "2026-w37": "founder 2026-09-03: '37 is fine for now' — the early w37 merge/tag stands; not a precedent",
});

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;            // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);    // nearest Thursday
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}

/** The release week a local date sits in: Sunday-start; numbered by the ISO week of its Monday. */
export function releaseWeek(localDate) {
  const d = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
  const dow = d.getUTCDay();                 // Sun=0
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() + (dow === 0 ? 1 : 1 - dow));
  return isoWeek(monday);
}

export function judge(ref, { on = todayLocal(), flexed = FLEXED } = {}) {
  const name = String(ref).replace(/^refs\/(heads|tags)\//, "");
  const m = name.match(/^(train|release)\/(\d{4})-w(\d{1,2})(?:([a-z]))?(?:\.(\d+))?$/);
  if (!m) return { ok: true, note: `${name}: not a train/* or release/* name — nothing to judge` };
  const [, kind, year, weekStr, , patch] = m;
  const week = Number(weekStr);
  const cur = releaseWeek(on);
  const isReleaseDay = on.getUTCDay() === 0;
  const key = `${year}-w${week}`;
  const flex = flexed[key] ? `FLEXED (${flexed[key]})` : null;
  const refuse = (why, fix) => ({ ok: false, defect: `${name}: ${why}`, hint: fix, current: `${cur.year}-w${cur.week}`, flexed: flex });
  if (Number(year) !== cur.year && !(week === 1 || cur.week >= 52)) return flex ? { ok: true, warn: flex } : refuse(`names year ${year}; today is in ${cur.year}-w${cur.week}`, "name the train for the release week it ships in");
  if (kind === "train") {
    const open = cur.week + 1;
    if (week === open) return { ok: true, note: `${name} is the open train (ships Sunday, release week ${open})` };
    if (week === cur.week && isReleaseDay) return { ok: true, note: `${name} ships today` };
    if (week === cur.week) return { ok: true, note: `${name} is this week's train, shipped or shipping — patch work rides release/${year}-w${week}.N` };
    if (flex) return { ok: true, warn: `${name}: ${flex}` };
    if (week > open) return refuse(`is ${week - open} week(s) AHEAD of the open train (today is release week ${cur.week}; the open train is w${open})`,
      `put this work on train/${year}-w${open} — "train/2026-w(NN+1) opens the same day" as w(NN) ships (SHIPPING.md § 2); a new train opens on release day, never before`);
    return refuse(`is ${cur.week - week} week(s) behind (release week ${cur.week})`, "an old train does not reopen — cut a patch tag of the current week, or start the open train");
  }
  // release/* tags
  if (week === cur.week) return { ok: true, note: `${name} is a ${patch ? "patch" : "release"} tag of the current release week` };
  if (week === cur.week + 1 && isReleaseDay) return { ok: true, note: `${name}: release day — the train ships` };
  if (flex) return { ok: true, warn: `${name}: ${flex}` };
  if (week > cur.week) return refuse(`names release week ${week} on a day in release week ${cur.week}`,
    `a ship cut mid-week is a patch of the CURRENT week — release/${year}-w${cur.week}.N; the w${week} tag is cut on its release day (Sunday)`);
  return { ok: true, note: `${name}: an older release tag (re-deploy lane)` };
}

export function todayLocal(tz = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

/**
 * THE TAG IS NAMED FOR THE WEEK IT SHIPS IN, NOT FOR THE TRAIN IT CAME FROM.
 *
 * The release workflows used to name the tag from the merge subject's train
 * (`train/2026-w38` → `release/2026-w38`) and then ask `judge` — which refused
 * it on every mid-week ship, because the OPEN train is always named for NEXT
 * week (the 2026-09-08 class: the w37 continuation ship merged from
 * `train/2026-w38` on a Tuesday of release week 37; the workflow failed, and the
 * tags w37.5 and w37.6 were cut by hand). The subject names where the work came
 * FROM; the clock names what the ship IS. So the workflow asks this for the
 * base, and `judge` stays as the confirmation on the tag it then cuts.
 *
 *   train w(cur)   → release/w(cur)      (this week's train: its ship, or a patch of it)
 *   train w(cur+1) → release/w(cur)      (the open train merged mid-week: a patch of the CURRENT week;
 *                                         on Sunday cur has already rolled, so it is release/w(cur) too)
 *   anything else  → no lawful tag (ok: false) — an old train does not reopen; two weeks ahead is the 09-03 class
 *
 * Returns { ok, base?, note?, defect?, hint? }. The `.N` suffix is the workflow's (it counts existing tags).
 */
export function tagBaseFor(trainRef, { on = todayLocal() } = {}) {
  const name = String(trainRef).replace(/^refs\/heads\//, "");
  const m = name.match(/^train\/(\d{4})-w(\d{1,2})$/);
  if (!m) return { ok: false, defect: `${name}: not a train/YYYY-wNN name — no tag base to derive` };
  const [, year, weekStr] = m;
  const week = Number(weekStr);
  const cur = releaseWeek(on);
  if (Number(year) !== cur.year && !(week === 1 || cur.week >= 52)) return { ok: false, defect: `${name}: names year ${year}; today is in ${cur.year}-w${cur.week}` };
  if (week === cur.week) return { ok: true, base: `release/${year}-w${cur.week}`, note: `${name} is this week's train — its tag is release/${year}-w${cur.week}[.N]` };
  if (week === cur.week + 1) return { ok: true, base: `release/${year}-w${cur.week}`, note: `${name} is the open train shipped mid-week — a patch of the CURRENT week, release/${year}-w${cur.week}.N (its own tag is cut on its Sunday)` };
  if (week > cur.week + 1) return { ok: false, defect: `${name}: is ${week - cur.week - 1} week(s) AHEAD of the open train (today is release week ${cur.week}; the open train is w${cur.week + 1})`, hint: `put this work on train/${year}-w${cur.week + 1}` };
  return { ok: false, defect: `${name}: is ${cur.week - week} week(s) behind (release week ${cur.week})`, hint: "an old train does not reopen — cut a patch tag of the current week from the open train" };
}

function selfTest() {
  const on = (s) => new Date(`${s}T00:00:00Z`);
  const cases = [
    ["train/2026-w37", "2026-09-03", true],     // the open train on a Thursday of week 36
    ["train/2026-w38", "2026-09-03", false],    // the 09-03 mistake — two weeks ahead
    ["train/2026-w38", "2026-09-06", true],     // release day: w37 ships, w38 opens
    ["train/2026-w37", "2026-09-06", true],     // release day: w37 ships today
    ["release/2026-w36.15", "2026-09-03", true],
    ["release/2026-w38", "2026-09-03", false],  // a tag two weeks ahead
    ["release/2026-w37", "2026-09-06", true],   // release day
    ["release/2026-w37", "2026-09-03", true],   // flexed by the founder's word (WARN)
    ["wright/some-feature", "2026-09-03", true],
  ];
  let bad = 0;
  for (const [ref, day, want] of cases) {
    const r = judge(ref, { on: on(day) });
    const got = r.ok;
    console.log(`${got === want ? "ok " : "RED"} ${ref} on ${day} → ${got ? "lawful" : "refused"}${r.warn ? " (" + r.warn + ")" : ""}${r.defect ? " — " + r.defect : ""}`);
    if (got !== want) bad++;
  }
  // --tag-for: the tag is named for the week it ships in, never for the train
  const tagCases = [
    ["train/2026-w38", "2026-09-08", "release/2026-w37"],  // the 09-08 class: the open train shipped on a Tuesday of week 37
    ["train/2026-w37", "2026-09-08", "release/2026-w37"],  // this week's train, patched mid-week
    ["train/2026-w38", "2026-09-13", "release/2026-w38"],  // its own Sunday: cur has rolled to 38
    ["train/2026-w39", "2026-09-08", null],                 // two weeks ahead — no lawful tag
    ["train/2026-w36", "2026-09-08", null],                 // an old train does not reopen
    ["release/2026-w37", "2026-09-08", null],               // not a train name
  ];
  for (const [ref, day, want] of tagCases) {
    const r = tagBaseFor(ref, { on: on(day) });
    const got = r.ok ? r.base : null;
    console.log(`${got === want ? "ok " : "RED"} --tag-for ${ref} on ${day} → ${got ?? "refused"}${r.defect ? " — " + r.defect : ""}`);
    if (got !== want) bad++;
  }
  // and every base --tag-for hands out must pass judge on the same day — the two halves agree
  for (const [ref, day, want] of tagCases) {
    if (!want) continue;
    const j = judge(want, { on: on(day) });
    console.log(`${j.ok ? "ok " : "RED"} judge(${want}) on ${day} → ${j.ok ? "lawful" : "refused"}`);
    if (!j.ok) bad++;
  }
  // and with the flex table emptied, the flexed case must refuse — the check can fail
  const r = judge("release/2026-w37", { on: on("2026-09-03"), flexed: {} });
  console.log(`${r.ok ? "RED" : "ok "} release/2026-w37 on 2026-09-03 with no flex → ${r.ok ? "lawful (the check cannot fail)" : "refused"}`);
  if (r.ok) bad++;
  const rw = releaseWeek(on("2026-09-06")); const rw2 = releaseWeek(on("2026-09-05"));
  console.log(`${rw.week === 37 && rw2.week === 36 ? "ok " : "RED"} release week arithmetic: Sat 09-05 → w${rw2.week}, Sun 09-06 → w${rw.week}`);
  if (!(rw.week === 37 && rw2.week === 36)) bad++;
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href || process.argv[1]?.endsWith("train-week-check.mjs")) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) selfTest();
  else if (args.includes("--tag-for")) {
    const ref = args[args.indexOf("--tag-for") + 1];
    if (!ref || ref.startsWith("--")) { console.error("usage: node tools/train-week-check.mjs --tag-for train/YYYY-wNN [--on YYYY-MM-DD]"); process.exit(2); }
    const onIdx = args.indexOf("--on");
    const on = onIdx >= 0 ? new Date(`${args[onIdx + 1]}T00:00:00Z`) : todayLocal();
    const r = tagBaseFor(ref, { on });
    if (r.ok) { console.error(`OK · ${r.note}`); console.log(r.base); process.exit(0); }
    const cur = releaseWeek(on);
    console.error(`REFUSED · ${r.defect}${r.hint ? "\n  " + r.hint : ""}\n  (today is release week ${cur.year}-w${cur.week}; a train is a week's ship — postmark-telemetry docs/SHIPPING.md § 2)`);
    process.exit(1);
  }
  else {
    const ref = args.find((a) => !a.startsWith("--"));
    if (!ref) { console.error("usage: node tools/train-week-check.mjs <ref> [--on YYYY-MM-DD] | --self-test"); process.exit(2); }
    const onIdx = args.indexOf("--on");
    const on = onIdx >= 0 ? new Date(`${args[onIdx + 1]}T00:00:00Z`) : todayLocal();
    const r = judge(ref, { on });
    if (r.ok) { if (r.warn) console.log(`WARN · ${r.warn}`); else console.log(`OK · ${r.note}`); process.exit(0); }
    console.error(`REFUSED · ${r.defect}\n  ${r.hint}\n  (today is release week ${r.current}; a train is a week's ship — postmark-telemetry docs/SHIPPING.md § 2)`);
    process.exit(1);
  }
}
