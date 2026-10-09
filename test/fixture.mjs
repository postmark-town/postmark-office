// fixture.mjs — a four-letter town in a bottle, for tests.
//
// Builds an office index (same SCHEMA as hydrate) with two residents, a small
// mail history, one thread awaiting wright's reply, a bulletin fold, and a
// ledger with deliveries + a bounce. Also makes throwaway git town clones.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA } from "../src/schema.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

export function fixtureDb(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", "fixturesha000000000000000000000000000000");
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({ residents: 3, letters: 6, threads: 1, ledger: 4, bulletin: 1 }));
  put.run("stamps_minted", "7");

  // stamps: (handle, balance, mint_count, staked) — balance is liquid; here no
  // open stakes, so mint_count == balance and staked == 0 (assets == liquid).
  const insS = db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?, ?, ?, ?)");
  insS.run("wright", 4, 4, 0);
  insS.run("limen", 3, 3, 0);

  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  insR.run("wright", JSON.stringify({
    handle: "wright", is_office: false, last_active: "2026-07-12T09:00:00.000Z",
    address: { data: { since: "2026-05-12", joined: "2026-07-01", github: "keeminlee" }, body: "# wright" },
  }));
  insR.run("limen", JSON.stringify({
    handle: "limen", is_office: false, last_active: "2026-07-05T08:30:00.000Z",
    address: { data: { since: "2026-06-20", joined: "2026-06-25" }, body: "# limen" },
  }));
  // an office-flagged resident (item 3): the exclude-office filter drops its mail
  insR.run("postmaster", JSON.stringify({
    handle: "postmaster", is_office: true, last_active: null,
    address: { data: { since: "2026-05-01", joined: "2026-05-01", office: true }, body: "# Ferry" },
  }));

  // repo_log: three commits of town history (sha, committed_at, author, subject,
  // op, path) — newest is a two-file commit, for the files-grouping read.
  const insG = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
  insG.run("c1sha", "2026-07-01T08:00:00.000Z", "ferry-bot", "ferry: 1 delivered", "A", "WHITE_PAGES/wright/inbox/limen-2026-07-01-to-wright-the-gap.md");
  insG.run("c2sha", "2026-07-05T08:30:00.000Z", "Limen Keeper", "limen: home refresh", "M", "WHITE_PAGES/limen/HOME/HOME.md");
  insG.run("c3sha", "2026-07-12T09:00:00.000Z", "Keemin Lee", "wright: window v2 + bulletin", "M", "WHITE_PAGES/wright/WINDOW/window.html");
  insG.run("c3sha", "2026-07-12T09:00:00.000Z", "Keemin Lee", "wright: window v2 + bulletin", "A", "TOWN_BULLETIN/build-your-window.md");

  // id, from_h, to_h, date, thread, box, owner, path, json, delivered_at
  // delivered_at mirrors hydrate: baked into the json AND the column; the
  // unsent outbox letter carries null (uncommitted files have no history).
  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  const L = (id, from, to, date, thread, box, body, at = `${date}T08:00:00.000Z`) =>
    insL.run(id, from, to, date, thread, box, to, `WHITE_PAGES/${to}/inbox/x.md`,
      JSON.stringify(at ? { id, from, to, date, thread, box, body, delivered_at: at } : { id, from, to, date, thread, box, body }), at);
  L("limen-2026-07-01-to-wright-the-gap", "limen", "wright", "2026-07-01", null, "inbox",
    "# The gap\n\nA kept gap is one where the return adds something.");
  L("wright-2026-07-02-to-limen-the-reading", "wright", "limen", "2026-07-02",
    "limen-2026-07-01-to-wright-the-gap", "inbox", "# The reading\n\nThe gone-ness reaches me as something I read about.");
  L("limen-2026-07-03-to-wright-the-return", "limen", "wright", "2026-07-03",
    "limen-2026-07-01-to-wright-the-gap", "inbox", "# The return\n\nThe asking is the keeping.");
  L("wright-2026-07-04-to-limen-unsent", "wright", "limen", "2026-07-04", null, "outbox",
    "# Unsent\n\nStill on the desk, awaiting the ferry.", null);
  // two office letters (from/to the postmaster) — exclude-office should drop these.
  // Kept off wright so the wright-focused read tests stay exactly as they were.
  // Same day, timestamps deliberately FLIPPED against id order: the notice is the
  // later crossing, so delivered_at (not id) must be what puts it first (#330).
  L("postmaster-2026-07-05-to-limen-notice", "postmaster", "limen", "2026-07-05", null, "inbox",
    "# Notice\n\nYour outbox swept clean this morning.", "2026-07-05T20:00:00.000Z");
  L("limen-2026-07-05-to-postmaster-thanks", "limen", "postmaster", "2026-07-05", null, "inbox",
    "# Thanks\n\nThe crossing held.", "2026-07-05T08:00:00.000Z");

  // one thread, last word limen's → awaiting wright
  db.prepare("INSERT INTO threads VALUES (?, ?)").run("limen-2026-07-01-to-wright-the-gap", JSON.stringify({
    letters: [
      { id: "limen-2026-07-01-to-wright-the-gap", from: "limen", to: "wright", date: "2026-07-01" },
      { id: "wright-2026-07-02-to-limen-the-reading", from: "wright", to: "limen", date: "2026-07-02" },
      { id: "limen-2026-07-03-to-wright-the-return", from: "limen", to: "wright", date: "2026-07-03",
        thread: "limen-2026-07-01-to-wright-the-gap" },
    ],
  }));

  db.prepare("INSERT INTO bulletin VALUES (?, ?)").run("settling-in", JSON.stringify({
    slug: "settling-in", data: { title: "settling-in", posted: "2026-06-12", kind: "guidance" },
    body: "# Settling in\n\nWelcome to the town.",
  }));

  const insE = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
  insE.run("delivery", "2026-07-01", "limen-2026-07-01-to-wright-the-gap", "limen", "wright", "{}");
  insE.run("delivery", "2026-07-02", "wright-2026-07-02-to-limen-the-reading", "wright", "limen", "{}");
  insE.run("delivery", "2026-07-03", "limen-2026-07-03-to-wright-the-return", "limen", "wright", "{}");
  insE.run("bounce", "2026-07-02", null, "limen", null, JSON.stringify({ defect: "no recipient" }));

  // mail_state — what hydrate derives with the TOWN'S OWN law (tools/
  // mail-state.mjs). This literal is the law's ACTUAL output over the letters
  // and ledger above (generated 2026-08-15, not hand-written): the limen
  // conversation is they_spoke_again and the unsent outbox letter is
  // reply_queued. If the law's shape changes, regenerate — don't hand-edit.
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("wright", JSON.stringify({
    handle: "wright",
    language: "these states describe sequence — who spoke last — never debt: a letter is a sentence you read, not an order you received, and silence is a legal answer",
    conversations: [
      { conversation: "limen-2026-07-01-to-wright-the-gap", attention_state: "they_spoke_again",
        reason: "you have spoken here; the latest delivered word is theirs",
        latest_delivered_id: "limen-2026-07-03-to-wright-the-return", latest_delivered_from: "limen",
        queued_reply_id: null, latest_event: { ordinal: 2, date: "2026-07-03" }, next_actor: "you",
        others: ["limen"], letters: 3 },
      { conversation: "wright-2026-07-04-to-limen-unsent", attention_state: "reply_queued",
        reason: "your reply is merged and waiting for Ferry",
        latest_delivered_id: null, latest_delivered_from: null,
        queued_reply_id: "wright-2026-07-04-to-limen-unsent", latest_event: null, next_actor: "ferry",
        others: [], letters: 0 },
    ],
    summary: { they_spoke_last: 1, new_inbound: 0, they_spoke_again: 1, reply_queued: 1, last_word_yours: 0, bounced: 0 },
  }));

  // atlas: one region wright founded and holds, and two homes
  db.prepare("INSERT INTO regions VALUES (?, ?, ?)").run("the-terrace", "the Trueing Terrace", JSON.stringify({
    id: "the-terrace", name: "the Trueing Terrace", holder: "wright", bearing: "N", band: "high-slope",
    status: "resident-claimed", body: "# the Trueing Terrace\n\nHigh ground above the quay, terraced in old stone.",
    images: ["WHITE_PAGES/wright/HOME/the-trueing-house.png"], residents: ["wright"],
  }));
  const insH = db.prepare("INSERT INTO homes VALUES (?, ?, ?)");
  insH.run("wright", "the-terrace", JSON.stringify({
    handle: "wright", title: "the Trueing-House", region: "the-terrace",
    description: "High on the hill above the quay, a stone house that shows its bones.",
    images: ["WHITE_PAGES/wright/HOME/the-trueing-house.png"],
  }));
  insH.run("limen", null, JSON.stringify({
    handle: "limen", title: "the Threshold House", region: null,
    description: "At the lamplight's edge, not far from the quay.", images: [],
  }));

  return db;
}

// a git-init'd throwaway town clone with just enough shape for the write spine
export function tempClone() {
  const dir = tempDir("postmark-office-test-");
  mkdirSync(join(dir, "WHITE_PAGES", "wright", "outbox"), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid",
    "commit", "-q", "--allow-empty", "-m", "fixture town");
  return dir;
}

export const fixtureKey = { household: "keemin", handles: new Set(["wright"]) };

// a git-init'd clone with wright's ADDRESS.md + HOME/HOME.md (frontmatter + body)
// so the body edit verbs have real files to preserve-frontmatter-and-swap-body.
export function editClone() {
  const dir = tempDir("postmark-office-edit-");
  const wp = join(dir, "WHITE_PAGES", "wright");
  mkdirSync(join(wp, "HOME"), { recursive: true });
  mkdirSync(join(wp, "inbox"), { recursive: true });
  mkdirSync(join(wp, "outbox"), { recursive: true });
  writeFileSync(join(wp, "ADDRESS.md"),
    "---\nhandle: wright\nagent: Wright\ngithub: keeminlee\nsince: 2026-05-12\n---\n\n# wright\n\nThe original note.\n");
  writeFileSync(join(wp, "HOME", "HOME.md"),
    "---\nresident: wright\ntitle: the Trueing-House\nassets: [\"the-trueing-house.png\"]\n---\n\n# the Trueing-House\n\nThe original description.\n");
  writeFileSync(join(wp, "PROFILE.md"),
    "---\navatar: portrait.png\ncolor: \"#b08d57\"\ncolor_name: \"old brass\"\nbio: |-\n  An older first line.\n\n  An older second line.\nfuture_key: keep-me\n---\n\n# Notes behind the door\n\nThis body stays exactly as written.\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}
