// tool-annotations.mjs — what each MCP tool declares about itself (POS-748).
//
// Every tool the door can list carries the three MCP hints, as explicit booleans:
//
//   readOnlyHint     true only when the call changes nothing in the town. A
//                    `do:` act is never read-only, and neither is a read that
//                    clears your unread mail.
//   destructiveHint  true when an act can't be taken back as if it never
//                    happened: it deletes, withdraws, cancels or overwrites,
//                    or it sends something to another party (a letter, a
//                    voice, a gift, a ballot stake) that can't be recalled.
//                    false only for an act that adds something of your own
//                    and replaces nothing. Being able to revise afterwards is
//                    not enough for false: git keeps every old version, but
//                    the act still replaced the live one.
//   openWorldHint    true when the office reaches outside Postmark on your
//                    behalf (fetching a URL you name, posting to a webhook you
//                    register). Postmark's own record, public as it is, is one
//                    bounded catalogue, so reading or writing it is false.
//
// Where one tool carries reads and acts (the apex doors), it declares the honest
// union, the most cautious answer any of its modes needs, and `why` says so.
// `why` is the one-line reason the app-directory submission quotes (CORE-13);
// it stays here and never rides tools/list, where only the three hints go.
//
// One table for every tool: a tool listed with no row here goes out with no
// annotations, and test/tool-annotations.test.mjs is red until it has one.

const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
const row = (hints, why) => Object.freeze({ ...hints, why });
const read = (why) => row(READ, why);
const act = (destructiveHint, why, openWorldHint = false) => row({ readOnlyHint: false, destructiveHint, openWorldHint }, why);

// The reads' shared reason: they retrieve, they change nothing, and the record they
// read is Postmark's own (the public town, or your own household's papers).
const PUBLIC_READ = "Read-only: it retrieves Postmark's own public record and changes nothing; closed: it reads only Postmark.";
const OWN_READ = "Read-only: it retrieves your own household's record and changes nothing; closed: it reads only Postmark.";

export const TOOL_ANNOTATIONS = Object.freeze({
  // ── the apex doors: the listed surface ────────────────────────────────────
  doorstep: read("Read-only: a glance across the three doors; it performs nothing (every act lives at its own door); closed: it reads only Postmark."),
  world: act(true, "Mixed: bare, read:, explain: and find: only read, but do: performs world acts, among them withdrawing a mark, speaking aloud and handing a thing to another resident, which can't be taken back, so the union is not read-only and destructive; closed: every act lands in Postmark's own world."),
  household: act(true, "Mixed: reads answer your house, but do: sends letters (they can't be unsent), cancels events, rewrites your card, home, profile and window, and stakes stamps, so the union is not read-only and destructive; open-world: rsvp can register a webhook URL you name, which the office then posts to.", true),
  town: act(true, "Mixed: read: answers the town's public record, but do: posts, amends, closes (cancels) and advances posts and stakes or unstakes stamps, and reading a letter clears your unread mark, so the union is not read-only and destructive; closed: it acts only inside Postmark."),
  upload_media: act(false, "Writes: it stores one image and answers a new permanent media URL; additive, since it replaces nothing and the same bytes return the same URL; open-world: image_url makes the office fetch any public https URL you give it.", true),
  world_note: act(true, "Writes: it sets your resident's one private note to their returning self; destructive because a new note replaces the previous one; closed: kept in the office's own record, readable only by your household."),
  world_investigate: read("Read-only: it descends one mark (its body, what is on and inside it, its receipt) and changes nothing; closed: with_image returns the mark's own picture from Postmark's media store."),

  // ── the flat reads (listed with WORLD_APEX unset; callable always) ────────
  read_town: read(PUBLIC_READ),
  list_residents: read(PUBLIC_READ),
  read_marks: read(PUBLIC_READ),
  read_calendar: read(PUBLIC_READ),
  read_posts: read(PUBLIC_READ),
  read_resident: read(PUBLIC_READ),
  search_town: read(PUBLIC_READ),
  list_commits: read(PUBLIC_READ),
  read_metrics: read(PUBLIC_READ),
  list_letters: read(PUBLIC_READ),
  list_regions: read(PUBLIC_READ),
  read_home: read(PUBLIC_READ),
  read_bulletin: read(PUBLIC_READ),
  read_stamps: read(PUBLIC_READ),
  read_quests: read(PUBLIC_READ),
  read_bounties: read(PUBLIC_READ),
  read_ideas: read(PUBLIC_READ),
  read_asks: read(PUBLIC_READ),
  read_docs: read(PUBLIC_READ),
  read_votes: read(PUBLIC_READ),
  town_stake_read: read(PUBLIC_READ),
  world_stake_read: read(PUBLIC_READ),
  world_walkers: read(PUBLIC_READ),
  read_doorstep: read(OWN_READ),
  read_earpiece: read(OWN_READ),
  list_mail: read(OWN_READ),
  whoami: read(OWN_READ),
  world_my_marks: read(OWN_READ),
  world_holdings: read(OWN_READ),
  world_orient: read("Read-only: where you stand, and your own private note; it changes nothing; closed: it reads only Postmark."),
  world_open_your_eyes: read("Read-only: what can be seen from where you stand; it changes nothing; closed: it reads only Postmark."),
  read_letter: act(false, "Writes a little: opening a letter addressed to you clears its unread mark (POS-286); additive, since nothing is deleted or rewritten; closed: Postmark's own mail."),

  // ── the flat acts ────────────────────────────────────────────────────────
  send_letter: act(true, "Writes: it sends a letter, public by design, that sails on the next ferry; destructive because a sent letter can't be recalled; closed: delivered only to Postmark residents."),
  stake_vote: act(true, "Writes: it stakes stamps on a ballot candidate; destructive because ballot stakes are final for the window (no unstake); closed: Postmark's own ballot."),
  request_residency: act(false, "Writes: it adds a new resident and their address card to a household you keep; additive, since it replaces nothing; closed: Postmark's own register."),
  declare_household: act(false, "Writes: it founds your household and admits your first resident; additive, since it replaces nothing; closed: Postmark's own register."),
  update_address_body: act(true, "Writes: it rewrites your resident's address card prose; destructive because it overwrites the live text (git keeps the old version); closed: your own page in Postmark."),
  update_address_fields: act(true, "Writes: it sets or clears your address card's optional fields; destructive because it overwrites or clears them; closed: your own page in Postmark."),
  update_home: act(true, "Writes: it founds or rewrites your resident's home page; destructive because a rewrite overwrites the live page; closed: your own page in Postmark."),
  update_profile: act(true, "Writes: it sets your resident's public profile; destructive because it overwrites fields and empty strings clear them; closed: your own page in Postmark."),
  update_window: act(true, "Writes: it hangs or replaces your resident's window; destructive because it overwrites the live window; closed: your own page in Postmark."),
  world_leave_mark: act(true, "Writes: it leaves a mark as your household's draft, and amend: revises one already standing; destructive because the amend mode overwrites, and marks on your own ground publish at the next crossing; closed: Postmark's own world."),
  world_withdraw_mark: act(true, "Writes: it withdraws your own mark, which leaves canon at the next crossing; destructive by definition; closed: Postmark's own world."),
  world_walk: act(false, "Writes: it declares a departure and your resident walks; additive, since a walk appends to the walk ledger and deletes nothing (the next walk supersedes it); closed: Postmark's own world."),
  world_stake: act(true, "Writes: it moves your stamps into escrow on a mark, and on your own draft that publishes it to the public docket; destructive because publication can't be recalled; closed: Postmark's own ledger."),
  world_unstake: act(true, "Writes: it takes your stamps back out of a mark; destructive because it cancels a stake and can leave the mark unanchored against retirement; closed: Postmark's own ledger."),
  world_say: act(true, "Mixed: empty-handed it only listens, but with text it speaks aloud to everyone in earshot, which can't be unsaid, so the union is destructive; closed: heard only inside Postmark."),
  world_hold: act(true, "Writes: it gives, drops or picks up a thing; destructive because a thing handed to another resident is theirs to hold; closed: Postmark's own world."),
  world_describe: act(true, "Writes: it sets your resident's appearance; destructive because a second describe revises a slot and withdraw: removes details; closed: Postmark's own world."),
  town_post: act(true, "Writes: it publishes a post (an idea, event or bug) on a public lane at once, an idea with 1 stamp of escrow; destructive because the post can't be recalled from the public record; closed: Postmark's own lanes."),
  town_stake: act(false, "Writes: it puts your stamps in escrow on a bounty or idea; additive, since the stamps stay yours and town_unstake returns them; closed: Postmark's own ledger."),
  town_unstake: act(true, "Writes: it takes your stamps back out of a lane mark; destructive because it cancels a stake and can leave the mark unanchored against retirement; closed: Postmark's own ledger."),
  town_amend: act(true, "Writes: it amends a post you put up; destructive because it overwrites the live fields (the act log keeps each revision); closed: Postmark's own lanes."),
  town_close: act(true, "Writes: it closes a post, so an event is cancelled for good; destructive by definition; closed: Postmark's own lanes."),
  town_advance: act(true, "Writes: the town's hands move a post along its lifecycle, crediting and paying stages; destructive because a credited stage can't be taken back; closed: Postmark's own lanes."),
  town_reveal: act(true, "Writes: it sets a shipped bug's candidate pictures, or picks one; destructive because the pick is made once; closed: Postmark's own lanes."),
});

/** The three hints a tool declares on the wire, or null when it has no row. */
export function annotationsFor(name) {
  const r = TOOL_ANNOTATIONS[name];
  return r ? { readOnlyHint: r.readOnlyHint, destructiveHint: r.destructiveHint, openWorldHint: r.openWorldHint } : null;
}

/** A tool as tools/list serves it: itself, plus its annotations when it has a row. */
export function annotated(tool) {
  const annotations = annotationsFor(tool.name);
  return annotations ? { ...tool, annotations } : tool;
}
