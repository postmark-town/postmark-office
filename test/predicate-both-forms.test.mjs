// predicate-both-forms.test.mjs — W2 renames `kind: predicated` to `kind:
// predicate` (settled on WLD-73, G10). New descriptions WRITE the new form;
// every reader takes both (LOGOS v2 part 2, lane O2's scope addition).
//
//   · the git-era writer (src/leave-exec.mjs), over a throwaway world: a
//     description left as `predicated` or as `predicate`, under an old-form
//     sited parent (`kind: sited`) or a new-form one (`kind: thing`, sited by
//     its class's lineage), files `kind: predicate` each time;
//   · the door's read of law in predicated shape (world-apex § lawOf) keys on
//     the slot, so a `predicated` and a `predicate` node both quote.

import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { markRecord, recordKindOf } from "../src/mark-record.mjs";

test("a new file writes kind: predicate for either spelling; every other kind as declared", () => {
  assert.equal(recordKindOf("predicated"), "predicate");
  assert.equal(recordKindOf("predicate"), "predicate");
  for (const k of ["sited", "parcel", "naming", "thing"]) assert.equal(recordKindOf(k), k);
});

test("the door's law in predicated shape quotes a `predicated` node and a `predicate` node alike (it keys on the slot)", async () => {
  const { graphDb } = await import("../src/world-graph-db.mjs");
  const { lawOf } = await import("../src/world-apex.mjs");
  const n = (id, subkind, props) => ({ id, kind: "mark", subkind, tier: "constitution", by: "the-town", at_x: null, at_y: null, extent_w: null, extent_h: null, props: JSON.stringify(props) });
  const db = graphDb({ meta: [{ key: "hydration_status", value: "OK" }], edges: [], events: [], geometryVersions: [], lintFindings: [],
    nodes: [n("logos/old-form", "predicated", { slot: "media", value: "open", body: "The old spelling." }),
      n("logos/new-form", "predicate", { slot: "media", value: "open", body: "The new spelling." })] });
  assert.equal(lawOf(db, "logos/old-form")?.text ?? lawOf(db, "logos/old-form")?.body, "The old spelling.");
  assert.equal(lawOf(db, "logos/new-form")?.text ?? lawOf(db, "logos/new-form")?.body, "The new spelling.");
});

const WORLD = worldClone();
const skip = (!WORLD && NO_WORLD) || false;
const repo = mkdtempSync(join(tmpdir(), "o2-predicate-forms-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const HOUSE = "o2-fixture", BRANCH = `draft/${HOUSE}`;
const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
const OLD = { id: "cy/old-form-lamp", by: "cy", slug: "old-form-lamp", kind: "sited", class: "thing", at: { x: 10, y: 10 }, extent: { w: 2, h: 2 } };
const NEW = { id: "cy/new-form-lamp", by: "cy", slug: "new-form-lamp", kind: "thing", at: { x: 30, y: 10 }, extent: { w: 2, h: 2 } };
const fileOf = (m) => `WORLD/marks/${m.by}/${m.slug}/mark.md`;

if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  // the class nodes a new-form `kind: thing` stands by: thing extends sited
  put("WORLD/marks/the-town/sited/mark.md", markRecord({ id: "the-town/sited", by: "the-town", slug: "sited", kind: "class", tier: "constitution", extends: "mark" }, "A sited mark stands somewhere."));
  put("WORLD/marks/the-town/thing/mark.md", markRecord({ id: "the-town/thing", by: "the-town", slug: "thing", kind: "class", tier: "constitution", extends: "sited" }, "A thing is made, held or set down."));
  put(fileOf(OLD), markRecord(OLD, "A lamp in the old form."));
  put(fileOf(NEW), markRecord(NEW, "A lamp in the new form."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, OLD, NEW] }));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("add", "-A", "WORLD", "tools"); git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon");
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "", TOWN_CLONE: join(repo, "no-town"), TOWN_PUSH: "", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" });
  delete process.env.WORLD2_PG_URL;
}
const KEY = { household: HOUSE, handles: new Set(["cy"]) };
const describe = async (parent, kind, slug) => (await import("../src/world.mjs")).leaveMarkViaOffice(repo,
  { slug, kind, parent_id: parent.id, slot: "colour", value: "amber", body: "It glows amber." }, KEY);
const written = (r) => { const f = git("show", `${BRANCH}:WORLD/marks/${r.dir ?? ""}/mark.md`); return f; };

for (const [parent, form] of [[OLD, "old-form parent (kind: sited + class: thing)"], [NEW, "new-form parent (kind: thing, sited by lineage)"]])
  for (const kind of ["predicated", "predicate"])
    test(`the git writer files kind: predicate · a "${kind}" description under a ${form}`, { skip }, async () => {
      const r = await describe(parent, kind, `${parent.slug}-colour-${kind}`);
      assert.equal(r.error, undefined, JSON.stringify(r));
      const text = written(r);
      assert.match(text, /^kind: predicate$/m, text);
      assert.doesNotMatch(text, /^kind: predicated$/m);
    });
