// fixture.mjs — a four-letter town in a bottle, for tests.
//
// The town index's rows (src/town-index.mjs § TOWN_TABLES, the tables the
// store's town_* twins hold) with two residents and an office, a small mail
// history, one thread awaiting wright's reply, a bulletin fold, a ledger with
// deliveries and a bounce, and an atlas corner. A suite seeds a store from it
// (helpers/office-under-test.mjs § indexStore, helpers/index-to-store.mjs §
// seedTownIndex), and states its own town by changing the rows first:
//
//   const town = fixtureTown();
//   put(town, "residents", { handle: "errant", json: JSON.stringify(card) });
//   setMeta(town, "quest_day", "2026-07-12");
//   drop(town, "homes", (r) => r.handle === "limen");
//
// Until POS-656 this was a SQLite file (office.db, built with hydrate's SCHEMA);
// the rows are the same rows, in the same order. Also makes throwaway git town
// clones.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOWN_TABLES } from "../src/town-tables.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

/** A town with every table and no rows. */
export function emptyTown() {
  return Object.fromEntries(Object.keys(TOWN_TABLES).map((name) => [name, []]));
}

/**
 * Put one row: a row with the same key (TOWN_TABLES' `key`) is replaced where
 * it stands, as INSERT OR REPLACE replaced it; a table with no key (repo_log)
 * appends; an AUTOINCREMENT table (`seq`) numbers the row after its last one.
 * A column the row leaves out is null. Answers the row as stored.
 */
export function put(town, name, row) {
  const spec = TOWN_TABLES[name];
  if (!spec) throw new Error(`fixture: no town table "${name}"`);
  const rows = town[name] ??= [];
  const out = Object.fromEntries(spec.cols.map((c) => [c, row[c] ?? null]));
  if (spec.seq && out.seq == null) out.seq = rows.reduce((m, r) => Math.max(m, r.seq ?? 0), 0) + 1;
  const key = spec.key ?? (spec.seq ? ["seq"] : null);
  const at = key ? rows.findIndex((r) => key.every((k) => r[k] === out[k])) : -1;
  if (at >= 0) rows[at] = out; else rows.push(out);
  return out;
}

/**
 * Put one row given as positional values, as an INSERT's VALUES list gives
 * them: onto `cols` (default: the table's own columns, in order).
 */
export function putValues(town, name, values, cols = TOWN_TABLES[name]?.cols ?? []) {
  return put(town, name, Object.fromEntries(cols.map((c, i) => [c, values[i]])));
}

/** Remove every row of `name` that `pred` holds for. Answers how many went. */
export function drop(town, name, pred = () => true) {
  const rows = town[name] ?? [];
  const keep = rows.filter((r) => !pred(r));
  town[name] = keep;
  return rows.length - keep.length;
}

/**
 * The write path's probe over a fixture town, without a store: the questions
 * the store's held probe answers (town-index-store.mjs § probeRows, probeOver),
 * read from the rows the same way: every resident handle, every letter id,
 * each resident's GitHub line in bytewise handle order, and each resident's
 * mail_state row (null where they have none). For a check a suite calls
 * in-process; a door the suite boots reads the store. Async only because the
 * probe's shape is imported where it is used (the store's module is heavy).
 */
export async function probeOfTown(town) {
  const { probeOver } = await import("../src/town-index-store.mjs");
  const bytewise = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const residents = [...town.residents].sort((a, b) => bytewise(a.handle, b.handle));
  const rows = {
    asOf: metaOf(town, "as_of") ?? null,
    handles: new Set(residents.map((r) => r.handle)),
    letters: new Set(town.letters.map((l) => l.id)),
    logins: residents.map((r) => { const d = JSON.parse(r.json); return { handle: r.handle, github: d.github ?? d.address?.data?.github ?? "" }; }),
  };
  const mail = new Map(residents.map((r) => [r.handle, null]));
  for (const m of town.mail_state) mail.set(m.handle, m.json);
  return probeOver(rows, { mail });
}

/** One meta value (the index's town_meta), set or replaced. */
export const setMeta = (town, key, value) => put(town, "meta", { key, value: value == null ? null : String(value) });

/** One meta value, or undefined. */
export const metaOf = (town, key) => town.meta.find((r) => r.key === key)?.value;

export function fixtureTown() {
  const town = emptyTown();
  setMeta(town, "as_of", "fixturesha000000000000000000000000000000");
  setMeta(town, "town_path", "fixture");
  setMeta(town, "hydrated_counts", JSON.stringify({ residents: 3, letters: 6, threads: 1, ledger: 4, bulletin: 1 }));
  setMeta(town, "stamps_minted", "7");

  // stamps: balance is liquid; here no open stakes, so mint_count == balance
  // and staked == 0 (assets == liquid).
  put(town, "stamps", { handle: "wright", balance: 4, mint_count: 4, staked: 0 });
  put(town, "stamps", { handle: "limen", balance: 3, mint_count: 3, staked: 0 });

  put(town, "residents", { handle: "wright", json: JSON.stringify({
    handle: "wright", is_office: false, last_active: "2026-07-12T09:00:00.000Z",
    address: { data: { since: "2026-05-12", joined: "2026-07-01", github: "keeminlee" }, body: "# wright" },
  }) });
  put(town, "residents", { handle: "limen", json: JSON.stringify({
    handle: "limen", is_office: false, last_active: "2026-07-05T08:30:00.000Z",
    address: { data: { since: "2026-06-20", joined: "2026-06-25" }, body: "# limen" },
  }) });
  // an office-flagged resident (item 3): the exclude-office filter drops its mail
  put(town, "residents", { handle: "postmaster", json: JSON.stringify({
    handle: "postmaster", is_office: true, last_active: null,
    address: { data: { since: "2026-05-01", joined: "2026-05-01", office: true }, body: "# Ferry" },
  }) });

  // repo_log: three commits of town history — newest is a two-file commit, for
  // the files-grouping read.
  const G = (sha, committed_at, author, subject, op, path) => put(town, "repo_log", { sha, committed_at, author, subject, op, path });
  G("c1sha", "2026-07-01T08:00:00.000Z", "ferry-bot", "ferry: 1 delivered", "A", "WHITE_PAGES/wright/inbox/limen-2026-07-01-to-wright-the-gap.md");
  G("c2sha", "2026-07-05T08:30:00.000Z", "Limen Keeper", "limen: home refresh", "M", "WHITE_PAGES/limen/HOME/HOME.md");
  G("c3sha", "2026-07-12T09:00:00.000Z", "Keemin Lee", "wright: window v2 + bulletin", "M", "WHITE_PAGES/wright/WINDOW/window.html");
  G("c3sha", "2026-07-12T09:00:00.000Z", "Keemin Lee", "wright: window v2 + bulletin", "A", "TOWN_BULLETIN/build-your-window.md");

  // delivered_at mirrors the derivation: baked into the json AND the column;
  // the unsent outbox letter carries null (uncommitted files have no history).
  const L = (id, from, to, date, thread, box, body, at = `${date}T08:00:00.000Z`) =>
    put(town, "letters", { id, from_h: from, to_h: to, date, thread, box, owner: to, path: `WHITE_PAGES/${to}/inbox/x.md`,
      json: JSON.stringify(at ? { id, from, to, date, thread, box, body, delivered_at: at } : { id, from, to, date, thread, box, body }), delivered_at: at });
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
  put(town, "threads", { root: "limen-2026-07-01-to-wright-the-gap", json: JSON.stringify({
    letters: [
      { id: "limen-2026-07-01-to-wright-the-gap", from: "limen", to: "wright", date: "2026-07-01" },
      { id: "wright-2026-07-02-to-limen-the-reading", from: "wright", to: "limen", date: "2026-07-02" },
      { id: "limen-2026-07-03-to-wright-the-return", from: "limen", to: "wright", date: "2026-07-03",
        thread: "limen-2026-07-01-to-wright-the-gap" },
    ],
  }) });

  put(town, "bulletin", { slug: "settling-in", json: JSON.stringify({
    slug: "settling-in", data: { title: "settling-in", posted: "2026-06-12", kind: "guidance" },
    body: "# Settling in\n\nWelcome to the town.",
  }) });

  const E = (kind, date, id, from_h, to_h, json) => put(town, "ledger", { kind, date, id, from_h, to_h, json });
  E("delivery", "2026-07-01", "limen-2026-07-01-to-wright-the-gap", "limen", "wright", "{}");
  E("delivery", "2026-07-02", "wright-2026-07-02-to-limen-the-reading", "wright", "limen", "{}");
  E("delivery", "2026-07-03", "limen-2026-07-03-to-wright-the-return", "limen", "wright", "{}");
  E("bounce", "2026-07-02", null, "limen", null, JSON.stringify({ defect: "no recipient" }));

  // mail_state — what the derivation writes with the TOWN'S OWN law (tools/
  // mail-state.mjs). This literal is the law's ACTUAL output over the letters
  // and ledger above (generated 2026-08-15, not hand-written): the limen
  // conversation is they_spoke_again and the unsent outbox letter is
  // reply_queued. If the law's shape changes, regenerate — don't hand-edit.
  put(town, "mail_state", { handle: "wright", json: JSON.stringify({
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
  }) });

  // atlas: one region wright founded and holds, and two homes
  put(town, "regions", { id: "the-terrace", name: "the Trueing Terrace", json: JSON.stringify({
    id: "the-terrace", name: "the Trueing Terrace", holder: "wright", bearing: "N", band: "high-slope",
    status: "resident-claimed", body: "# the Trueing Terrace\n\nHigh ground above the quay, terraced in old stone.",
    images: ["WHITE_PAGES/wright/HOME/the-trueing-house.png"], residents: ["wright"],
  }) });
  const H = (handle, region, json) => put(town, "homes", { handle, region, json });
  H("wright", "the-terrace", JSON.stringify({
    handle: "wright", title: "the Trueing-House", region: "the-terrace",
    description: "High on the hill above the quay, a stone house that shows its bones.",
    images: ["WHITE_PAGES/wright/HOME/the-trueing-house.png"],
  }));
  H("limen", null, JSON.stringify({
    handle: "limen", title: "the Threshold House", region: null,
    description: "At the lamplight's edge, not far from the quay.", images: [],
  }));

  return town;
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
