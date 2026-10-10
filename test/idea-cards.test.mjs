// idea-cards.test.mjs — what the cards teach about ideas, with IDEA_POSTS off and on (POS-290).
//
//   node --test test/idea-cards.test.mjs
//
// Wright's seam review of #463, notes 1–4: with the switch on, the town tool's
// description and the town_post card still taught the mark road (the Tank cell,
// the 1✦ escrow) before saying an idea is a post. The office reads its cards at
// load, so each state is read in its own child process.
//
//   1. ON: the town tool, the town_post card and the post act's card teach the
//      idea POST, and none of them teaches the mark road's escrow for an idea;
//   2. OFF: every one of them teaches the mark road, as before, and none says
//      an idea is a post;
//   3. ON or OFF: the idea acts' flat verbs are delisted (born behind the apex),
//      and the town tool's do: enum carries them only when on;
//   4. the award card states the label rule exactly as the ledger keeps it, and
//      the award's refusal to a hand who is not an award's names who awards;
//   5. OFF is pinned: the town's whole card surface (the town tool and its
//      schema, the bare read with its register law, every act's card, the
//      town flat verbs, the listed names) is byte-identical to
//      test/fixtures/town-cards-off.json: the surface the w42 train serves
//      with the class shut (proved equal to a4c38821's src, #464 merged, and so
//      to #463's; before #463 only read_posts differs, which takes class idea
//      because the reads are not switched).
//      A lane that changes a town card on purpose rewrites the fixture with
//      UPDATE_TOWN_CARDS=1 node --test test/idea-cards.test.mjs, and the diff
//      shows in its review.
//
// THE FLIPS are in G:/Starstory/docs/2026-10-09/rail/plumb-idea-plan/NOTES.md § the review notes.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The cards as an office with this env reads them at load. */
function cards(env) {
  const src = `
    const { toolList, TOOLS } = await import(${JSON.stringify(pathToFileURL(resolve(ROOT, "src", "mcp.mjs")).href)});
    const apex = await import(${JSON.stringify(pathToFileURL(resolve(ROOT, "src", "town-apex.mjs")).href)});
    const town = apex.TOWN_TOOL;
    const post = await apex.townApex({ read: "post" }, null, { schemas: {}, schemaRequired: {} });
    const listed = toolList().map((t) => t.name);
    // the surface the OFF pin compares, whole
    const reads = {};
    for (const a of apex.TOWN_DISPATCHABLE) reads[a] = await apex.townApex({ read: a }, null, { schemas: {}, schemaRequired: {} });
    const bare = await apex.townApex({}, null, { schemas: {}, schemaRequired: {} });
    const surface = { town: { description: town.description, inputSchema: town.inputSchema }, bare, reads,
      flat: TOOLS.filter((t) => /^town_/.test(t.name) || ["read_posts", "read_ideas"].includes(t.name)),
      listed: toolList().map((t) => t.name) };
    process.stdout.write("CARDS" + JSON.stringify({
      surface,
      town: town.description,
      doEnum: town.inputSchema.properties.do.enum,
      doText: town.inputSchema.properties.do.description,
      townPost: TOOLS.find((t) => t.name === "town_post"),
      award: TOOLS.find((t) => t.name === "town_award") ?? null,
      postInline: post.card?.blurb ?? null,
      listed,
    }));
  `;
  let out;
  try {
    out = execFileSync(process.execPath, ["--input-type=module", "-e", src], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, WORLD_APEX: "1", IDEA_POSTS: "", ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // a card swap that no longer finds its segment throws at load: say which
    throw new Error(`the office did not load with ${JSON.stringify(env)}: ${String(e.stderr ?? e.message).split("\n").filter((l) => /Error/.test(l)).slice(0, 3).join(" | ")}`);
  }
  return JSON.parse(out.slice(out.indexOf("CARDS") + 5));
}

const ON = cards({ IDEA_POSTS: "1" });
const OFF = cards({ IDEA_POSTS: "" });
const MARK_ESCROW = /1✦ escrow rides unless you pass more|stakes 1 stamp unless you pass more|stakes 1✦ escrow unless you pass more/;

test("1 · ON: the town tool, the town_post card and the post act's card teach the idea POST, and none teaches the mark road's escrow for an idea", () => {
  assert.match(ON.town, /class: "idea" is a POST on this office \(POS-290\) — args: \{ class: "idea", title, body \}/);
  assert.doesNotMatch(ON.town, MARK_ESCROW);
  assert.match(ON.town, /do: "sign-up"/);
  assert.match(ON.town, /do: "award" \(wright or keemin\)/);
  assert.ok(ON.townPost.description.startsWith(`Post something with a life in the town — town { do: "post" }'s flat charge name. class: "idea" IS A POST on this office`),
    "the town_post card opens on the post");
  assert.doesNotMatch(ON.townPost.description, MARK_ESCROW);
  assert.doesNotMatch(ON.townPost.description, /AN IDEA MAY STAND ANYWHERE/);
  assert.match(ON.townPost.description, /AND class: "event" \(POS-288/, "the other classes stand as they were");
  assert.match(ON.townPost.inputSchema.properties.stamps.description, /refused for an idea post/);
  assert.match(ON.townPost.inputSchema.properties.body.description, /^class "idea": the idea, at most 600 characters/);
  assert.match(ON.postInline, /^put something with a life up in the town, by class\. class "idea" is a POST on this office/);
  assert.doesNotMatch(ON.postInline, MARK_ESCROW);
  assert.match(ON.doText, /args: \{ class: "idea", title, body \}/);
});

test("2 · OFF: every card teaches the mark road as before, and none says an idea is a post", () => {
  assert.match(OFF.town, /class: "idea" publishes at the Think Tank — args: \{ class: "idea", slug, body \}, the body is the claim \(one breath, ≤150 chars\), placement computed for you, 1✦ escrow rides unless you pass more\./);
  assert.ok(OFF.townPost.description.startsWith("Post an ask onto a civic lane — town { do: \"post\" }'s flat charge name. Today class: \"idea\" publishes at the Think Tank"));
  assert.ok(OFF.townPost.description.endsWith("A bug takes no stake."), "nothing is appended off");
  assert.match(OFF.postInline, /^put something with a life up in the town, by class\. class: "idea" publishes at the Think Tank/);
  assert.ok(OFF.postInline.endsWith("pays the flat ladder to whoever did it"));
  assert.match(OFF.doText, /args: \{ class: "idea", slug, body \}/);
  for (const t of [OFF.town, OFF.townPost.description, OFF.postInline, OFF.doText])
    assert.doesNotMatch(t, /IS A POST|is a POST|POS-290|sign-up|do: "award"/);
});

test("3 · the idea acts' flat verbs are never listed (born behind the apex); the town tool's do: carries them only when on", () => {
  for (const s of [ON, OFF])
    for (const v of ["town_sign_up", "town_answer_sign_up", "town_award"]) assert.ok(!s.listed.includes(v), `${v} listed flat`);
  for (const a of ["sign-up", "answer-sign-up", "award"]) {
    assert.ok(ON.doEnum.includes(a), `${a} on the menu, on`);
    assert.ok(!OFF.doEnum.includes(a), `${a} on the menu, off`);
  }
  assert.equal(OFF.award, null, "the award's flat card is not defined off");
});

test("4 · the award card states the label rule exactly as the ledger keeps it; the refusal to a hand who is not an award's names who awards", async () => {
  const { PAID_STAGES } = await import("../src/bugs.mjs");
  assert.ok(ON.award.description.includes(`a label is never one of a bug's paid stages (${PAID_STAGES.join(", ")})`), "the stage names are the class law's, never typed by hand");
  assert.doesNotMatch(ON.award.description, /never a bug's stage name/);
  const { judgeHand, AWARD_HANDS, judgeAward } = await import("../src/ideas.mjs");
  assert.throws(() => judgeHand({}, { handles: new Set(["architect"]) }, { hands: AWARD_HANDS, act: "award stamps" }),
    (e) => e.code === 403 && e.defect === "only wright and keemin award stamps" && /an award moves money/.test(e.hint));
  assert.throws(() => judgeHand({}, { handles: new Set(["finn"]) }, { act: "move an idea" }),
    (e) => e.code === 403 && e.defect === "only the town's hands move an idea");
  // exactly the rule: "shipped" is no paid stage, so it is a label the ledger takes
  const roll = new Set(["finn"]);
  assert.equal(judgeAward({ to: "finn", stamps: 5, label: "shipped" }, roll).label, "shipped");
  assert.throws(() => judgeAward({ to: "finn", stamps: 5, label: "briefed" }, roll), /a bug's stage/);
});

test("5 · OFF is pinned: the town's whole card surface is byte-identical to the surface the train serves with the idea class shut", () => {
  const fixture = resolve(ROOT, "test", "fixtures", "town-cards-off.json");
  const now = JSON.stringify(OFF.surface, null, 1) + "\n";
  if (process.env.UPDATE_TOWN_CARDS === "1") writeFileSync(fixture, now);
  assert.equal(now, readFileSync(fixture, "utf8"),
    "a town card changed with IDEA_POSTS off; if that is on purpose, rewrite the fixture (UPDATE_TOWN_CARDS=1) and let the review read its diff");
});

test("6 · ON: the register law, the bounties sentence and the do: text teach what the menu offers", () => {
  assert.match(ON.surface.bare.the_register_law, /class: "idea" is a post on this office \(POS-290\), title and body, with no place and no escrow;/);
  assert.doesNotMatch(ON.surface.bare.the_register_law, /placement computed for you/);
  assert.match(ON.surface.bare.the_register_law, /do: "sign-up" \/ "answer-sign-up" carry who builds an idea's parts and do: "award" records stamps owed on it/);
  assert.match(ON.townPost.description, /Bounties and listings open here after their migrations; until then bounties post at the world door\. AND class: "event"/);
  for (const a of ["sign-up", "answer-sign-up", "award"]) assert.match(ON.doText, new RegExp(`\\b${a} \\(`), `the do: text names ${a}`);
  assert.match(OFF.surface.bare.the_register_law, /class: "idea" publishes at the Think Tank, placement computed for you;/);
});

test("7 · a card swap keeps a dollar sign in its replacement as a dollar sign, and refuses a segment it does not find exactly once", async () => {
  const { swapOnce } = await import("../src/town-apex.mjs");
  assert.equal(swapOnce("a X b", "X", "$& and $1 and $$"), "a $& and $1 and $$ b");
  assert.throws(() => swapOnce("a b", "X", "y"), /no longer finds its segment once/);
  assert.throws(() => swapOnce("X X", "X", "y"), /no longer finds its segment once/);
});
