// law-shape-world.mjs — ONE LOGICAL WORLD, FILED IN EITHER SHAPE (WLD-116, lane 3).
//
// buildWorld({ shape }) makes a throwaway world checkout (a git repo with two commits, the
// pinned clone's own tools/ copied in, as test/hydrate-loot.test.mjs does) holding the same
// little town twice over:
//
//   class-marks   the OLD shape: the classes are `kind: class` marks filed under the Keeping Works
//   law-tree      the NEW shape: WORLD/law/the-keeping-works/foundry.json + <class>/node.md
//
// The pinned world clone predates postmark-world#304, so it has no tools/law.mjs or
// tools/law-tree.mjs. Until the pin moves past that PR, the new shape's tools are TEST DOUBLES of
// the contract the office reads (loadLaw / lawDirFor / isClass ...), written beside the copied
// tools; when the pinned clone carries the real ones they are used and the doubles are not written.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CLASS_MARKS = "class-marks";
export const LAW_TREE = "law-tree";

const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

const LAW_DOUBLE = `// TEST DOUBLE of postmark-world tools/law.mjs (the part the office reads)
export const KEEPING_WORKS = "the-keeping-works";
export const isLawKind = (r) => r?.kind === "class" || r?.kind === "property";
export const foundryOf = (r) => (!isLawKind(r) ? null : (r.foundry || ((r.by ?? r.household ?? "the-town") === "the-town" ? KEEPING_WORKS : null)));
export const isClass = (r) => r?.kind === "class" && foundryOf(r) != null;
export const isProperty = (r) => r?.kind === "property";
export const isLawNode = (r) => isClass(r) || isProperty(r);
export const classRoster = (rs) => new Set((rs ?? []).filter(isClass).map((c) => String(c.class)));
`;
const TREE_DOUBLE = `// TEST DOUBLE of postmark-world tools/law-tree.mjs
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseRecord } from "./marks-fold.mjs";
export const lawDirFor = (marksDir) => join(dirname(resolve(marksDir)), "law");
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export function loadLaw(lawDir) {
  const foundries = [], nodes = [];
  if (existsSync(lawDir)) for (const f of readdirSync(lawDir).sort()) {
    const dir = join(lawDir, f);
    if (f.startsWith("_") || !isDir(dir)) continue;
    foundries.push({ ...JSON.parse(readFileSync(join(dir, "foundry.json"), "utf8")), dir });
    const walk = (d, parent) => {
      let me = parent;
      if (existsSync(join(d, "node.md"))) {
        const slug = basename(d);
        const rec = parseRecord(readFileSync(join(d, "node.md"), "utf8"), slug + "/node.md");
        Object.assign(rec, { _stray: {}, slug, household: rec.by, id: rec.by + "/" + slug, _dir: d, foundry: f, _law: true, _parentMarkId: parent });
        rec.tier ??= "market";
        nodes.push(rec); me = rec.id;
      }
      for (const e of readdirSync(d)) { const p = join(d, e); if (e !== "node.md" && !e.startsWith("_") && isDir(p)) walk(p, me); }
    };
    for (const e of readdirSync(dir).sort()) { const p = join(dir, e); if (!e.startsWith("_") && isDir(p)) walk(p, null); }
  }
  return { foundries, table: new Map(foundries.map((x) => [x.foundry, x])), nodes, problems: [] };
}
`;

// the classes: [path under the works / foundry, frontmatter, body]
const THING_ACTIONS = '[{"action": "take", "residue": "the-town/take"}, {"action": "set-down", "residue": "the-town/set-down"}]';
export const CLASSES = [
  ["mark", "kind: class\nby: the-town\ntier: constitution\ndate: 2026-08-18\nclass: mark\nversion: 1", "The root."],
  ["mark/sited", "kind: class\nby: the-town\ntier: constitution\ndate: 2026-08-18\nclass: sited\nversion: 1\nextends: mark", "What stands on ground."],
  ["mark/sited/thing", `kind: class\nby: the-town\ntier: constitution\ndate: 2026-08-18\nclass: thing\nversion: 1\nextends: sited\nactions: ${THING_ACTIONS}`, "A thing."],
  ["mark/sited/thing/carry-cap", "kind: property\nby: the-town\ntier: constitution\ndate: 2026-10-17\nname: carry_cap\ndefault: 10", "How much a hand holds."],
];

const fm = (front, body) => `---\n${front}\n---\n\n${body}\n`;
const put = (file, text) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text); };

/** Build the world in `shape`; returns the checkout directory. */
export function buildWorld({ shape, worldClone }) {
  const dir = mkdtempSync(join(tmpdir(), `pm-law-${shape === LAW_TREE ? "tree" : "marks"}-`));
  cpSync(join(worldClone, "tools"), join(dir, "tools"), { recursive: true });
  if (shape === LAW_TREE && !existsSync(join(dir, "tools", "law-tree.mjs"))) {
    writeFileSync(join(dir, "tools", "law.mjs"), LAW_DOUBLE);
    writeFileSync(join(dir, "tools", "law-tree.mjs"), TREE_DOUBLE);
  }
  const marks = join(dir, "WORLD", "marks");
  put(join(marks, "let-there-be-light", "mark.md"), fm("kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative", "Let there be light."));
  put(join(marks, "let-there-be-light", "the-keeping-works", "mark.md"), fm("kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 1000, h: 1000 }", "Postmark's book."));
  if (shape === CLASS_MARKS) {
    for (const [path, front, body] of CLASSES) put(join(marks, "let-there-be-light", "the-keeping-works", ...path.split("/"), "mark.md"), fm(front, body));
  } else {
    put(join(dir, "WORLD", "law", "the-keeping-works", "foundry.json"), JSON.stringify({ foundry: "the-keeping-works", tier: "constitution", extends: null, seat: "the-town/the-keeping-works", authors: ["the-town"] }));
    for (const [path, front, body] of CLASSES) put(join(dir, "WORLD", "law", "the-keeping-works", ...path.split("/"), "node.md"), fm(front, body));
  }
  put(join(dir, "WORLD", "skeleton.json"), JSON.stringify({ physics_registry: {} }));
  gitq(dir, ["init", "-q", "."]); gitq(dir, ["add", "-A"]); gitq(dir, ["commit", "-qm", "the tree"]);
  put(join(marks, "rei", "a-pebble", "mark.md"), fm("kind: sited\nby: rei\ntier: market\ndate: 2026-10-23\nat: { x: 10, y: 10 }\nextent: { w: 0.1, h: 0.1 }\nclass: thing", "A pebble."));
  gitq(dir, ["add", "-A"]); gitq(dir, ["commit", "-qm", "a pebble"]);
  return dir;
}
