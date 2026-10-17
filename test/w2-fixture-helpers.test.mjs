// w2-fixture-helpers.test.mjs — the two helpers that let a fixture or a golden read either world (LOGOS v2 part 2, W2).
//
// test/helpers/engine-closure.mjs copies world engine modules with what they
// import; test/helpers/kind-forms.mjs reads a W2 kind back in the old form's
// word. Each is a test instrument other suites stand on, so each is held here
// against the cases that would make it quietly wrong.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/w2-fixture-helpers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { copyEngineFiles, relativeSpecifiers } from "./helpers/engine-closure.mjs";
import { oldFormKind, stakeKindsInOldForm } from "./helpers/kind-forms.mjs";

// Left in the OS temp dir: this file deletes nothing.
const world = (files) => {
  const root = mkdtempSync(join(tmpdir(), "engine-closure-"));
  for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); }
  return root;
};

test("relativeSpecifiers: from-imports, re-exports, side-effect and dynamic imports, two on one line", () => {
  const src = [
    `import { a } from "./a.mjs"; import b from './b.mjs';`,
    `export * from "./c.mjs";`,
    `import {`,
    `  d,`,
    `} from "./d.mjs";`,
    `import "./e.mjs";`,
    `const f = await import("./f.mjs");`,
    `import { g } from "node:fs";`,
    `import h from "pg";`,
  ].join("\n");
  assert.deepEqual(relativeSpecifiers(src), ["./a.mjs", "./b.mjs", "./c.mjs", "./d.mjs", "./e.mjs", "./f.mjs"]);
});

test("copyEngineFiles follows every relative import, transitively, and copies nothing else", () => {
  const from = world({
    "tools/engine.mjs": `import { a } from "./a.mjs"; import { b } from "./b.mjs";\nimport "./side.mjs";\nexport const lazy = () => import("./lazy.mjs");\n`,
    "tools/a.mjs": `export { c } from "./sub/c.mjs";\nexport const a = 1;\n`,
    "tools/b.mjs": `export const b = 2;\n`,
    "tools/side.mjs": `globalThis.side = true;\n`,
    "tools/lazy.mjs": `export const lazy = 3;\n`,
    "tools/sub/c.mjs": `import { b } from "../b.mjs";\nexport const c = b;\n`,
    "tools/unrelated.mjs": `export const no = 0;\n`,
  });
  const to = mkdtempSync(join(tmpdir(), "engine-closure-to-"));
  const copied = copyEngineFiles(from, to, ["engine.mjs"]);
  assert.deepEqual(copied.sort(), ["a.mjs", "b.mjs", "engine.mjs", "lazy.mjs", "side.mjs", "sub/c.mjs"]);
  for (const p of copied) assert.ok(existsSync(join(to, "tools", p)), `${p} was copied`);
  assert.equal(existsSync(join(to, "tools", "unrelated.mjs")), false, "a module nothing imports stays behind");
});

test("copyEngineFiles throws on a specifier that leaves tools/, naming the module", () => {
  const from = world({
    "tools/engine.mjs": `import { a } from "./a.mjs";\n`,
    "tools/a.mjs": `import { viewer } from "../spectator/viewer.mjs";\nexport const a = viewer;\n`,
    "spectator/viewer.mjs": `export const viewer = 1;\n`,
  });
  const to = mkdtempSync(join(tmpdir(), "engine-closure-to-"));
  assert.throws(() => copyEngineFiles(from, to, ["engine.mjs"]), /tools\/a\.mjs imports "\.\.\/spectator\/viewer\.mjs", which leaves tools\//);
});

// The class chain W2 files: thing and portal-ground under sited, the predicate class under the root.
const EXTENDS = new Map([["thing", "sited"], ["portal-ground", "sited"], ["sited", "mark"], ["mark", "postmark-node"], ["predicate", "postmark-node"], ["home", "mark"]]);
const extendsOf = (n) => EXTENDS.get(String(n)) ?? null;

test("oldFormKind: identity on the old form's words, a W2 class back to its standing, and an unknown left to red", () => {
  for (const k of ["sited", "predicated", "parcel", "naming", "post"]) assert.equal(oldFormKind(k, extendsOf), k, `${k} is the old form's own word`);
  assert.equal(oldFormKind("thing", extendsOf), "sited");
  assert.equal(oldFormKind("portal-ground", extendsOf), "sited");
  assert.equal(oldFormKind("predicate", extendsOf), "predicated");
  assert.equal(oldFormKind("home", extendsOf), "home", "a class that reaches neither standing is left as it is, so a golden reds on it");
  assert.equal(oldFormKind("no-such-class", extendsOf), "no-such-class");
});

test("stakeKindsInOldForm rewrites stakes rows only, wherever the segment stands, and reads the chain only when it must", async () => {
  const page = {
    full: { stakes: { rows: [{ mark: "a/x", kind: "thing", class: "commons" }, { mark: "a/y", kind: "predicate", class: "home" }] }, stances: { awaiting: [{ mark: "b/z", kind: "thing" }] } },
    slim: { stakes: { rows: [{ mark: "a/x", kind: "sited", class: "commons" }] } },
  };
  let asked = 0;
  await stakeKindsInOldForm(page, async () => { asked++; return extendsOf; });
  assert.deepEqual(page.full.stakes.rows.map((r) => r.kind), ["sited", "predicated"]);
  assert.equal(page.full.stakes.rows[0].class, "commons", "the stake's own class is not the mark's kind, and is untouched");
  assert.equal(page.full.stances.awaiting[0].kind, "thing", "a row outside a stakes segment is not this helper's");
  assert.equal(asked, 1, "the chain is read once");
  let none = 0;
  await stakeKindsInOldForm({ stakes: { rows: [{ kind: "sited" }, { kind: "predicated" }] } }, async () => { none++; return extendsOf; });
  assert.equal(none, 0, "a page in the old form never reads the clone");
});
