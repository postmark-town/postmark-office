// schema.mjs — the office index DDL, shared by hydrate.mjs and the test
// fixture so the two can never drift. The DB stays an INDEX, never the truth.

export const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE letters (
    id TEXT PRIMARY KEY, from_h TEXT, to_h TEXT, date TEXT,
    thread TEXT, box TEXT, owner TEXT, path TEXT, json TEXT,
    delivered_at TEXT
  );
  CREATE INDEX letters_to ON letters (to_h, date);
  CREATE INDEX letters_from ON letters (from_h, date);
  CREATE TABLE threads (root TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE bulletin (slug TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT, date TEXT, id TEXT, from_h TEXT, to_h TEXT, json TEXT
  );
  CREATE TABLE stamps (handle TEXT PRIMARY KEY, balance INTEGER, mint_count INTEGER, staked INTEGER);
  -- mail_state: each resident's correspondence state, derived at hydrate by
  -- the TOWN'S OWN law (tools/mail-state.mjs — imported live from the
  -- checkout, like stamps; HAL's "one derivation, every surface"). Nullable
  -- by absence: an office running against a checkout without the tool serves
  -- doorsteps with correspondence: null and says so, never a second-law guess.
  CREATE TABLE mail_state (handle TEXT PRIMARY KEY, json TEXT);
  -- sent_to / heard_from: JSON arrays of the correspondents behind today's bars,
  -- so a quest card can show WHO already counted (each counts once per day, so
  -- writing to them again earns nothing). Nullable by design — an older snapshot
  -- reads as [] via boardForHandle rather than crashing.
  CREATE TABLE quest_progress (handle TEXT PRIMARY KEY, send INTEGER, receive INTEGER, house_size INTEGER, house_send INTEGER, house_receive INTEGER, sent_to TEXT, heard_from TEXT);
  -- quest_standing: the facts behind the board's NON-daily rows — the six
  -- one-time onboarding rows and the budding-friendship milestone — folded
  -- whole-town at hydrate by the TOWN'S OWN quest-progress.mjs
  -- (onboardingFactsFor + foldFriendships), exactly as quest_progress folds
  -- the daily pair. It exists because those facts were derivable all along and
  -- were never joined to the board: queries.injectedComplete's own docstring
  -- said the onboarding rows are "deliberately NOT injected here … read_quests
  -- is a hot read", and that is a statement about the PER-REQUEST path, not
  -- about the record. This table is the standing answer to it: one whole-town
  -- fold at hydrate (measured 2026-09-08 at 155 residents: 178 ms for the
  -- onboarding facts, 183 ms for 938 friendship pairs), and the hot read stays
  -- a primary-key lookup.
  --
  -- Nullable by absence, like mail_state: an index built before this seam has
  -- no row, and questBoardFor then answers those rows exactly as it did before
  -- (measured: false, with a note naming the missing index) rather than
  -- reporting "not done" on the strength of an old hydrate.
  CREATE TABLE quest_standing (handle TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE repo_log (
    sha TEXT, committed_at TEXT, author TEXT, subject TEXT, op TEXT, path TEXT
  );
  CREATE INDEX repo_log_sha ON repo_log (sha);
  CREATE INDEX repo_log_path ON repo_log (path);
  CREATE INDEX repo_log_time ON repo_log (committed_at);
  CREATE TABLE regions (id TEXT PRIMARY KEY, name TEXT, json TEXT);
  CREATE TABLE homes (handle TEXT PRIMARY KEY, region TEXT, json TEXT);
  -- The funding seam (2026-08-21): pots are bounty files on the quest board;
  -- holo / receipts / escrow fold from the stamp-ledger's funding rows
  -- (src/funding.mjs). AMENDED 2026-09-17 at the founder's ruling ("non-
  -- spendable is repealed; the stamps are like any other, but are holo to
  -- signify the special source"): holo is fresh mint to a giver, liquid like
  -- any stamp. funding_holo is STILL a separate table, and the reason inverted
  -- — it used to keep holo out of a balance, and it now keeps it from being
  -- added to one TWICE. The balance and the mint count arrive in the stamps
  -- table from the town's own folds (src/hydrate.mjs § Stamps), holo already
  -- inside them;
  -- this table is the per-gift readout (which pot, which receipt, how many),
  -- never a second credit. No migration: the whole index rebuilds from the
  -- sealed ledger at every tick. funding_invalid holds the rows that claimed a
  -- funding kind and failed its field law: surfaced at the door, never
  -- silently rendered.
  CREATE TABLE pots (id TEXT PRIMARY KEY, json TEXT);
  -- funding_roll is the JOIN, materialized: each holo row against the
  -- pot-receipt its ref names, so a patron page can read who paid, how many
  -- dollars, when, and the holo minted for it without a second money row in the
  -- ledger. usd is NULL when no receipt in this ledger carries that ref --
  -- absent, never guessed. Nothing persists: the whole index rebuilds from the
  -- sealed ledger at every tick, so this table has no migration and no history.
  CREATE TABLE funding_roll (seq INTEGER PRIMARY KEY AUTOINCREMENT, patron TEXT, pot TEXT, usd REAL, date TEXT, receipt TEXT, holo INTEGER);
  CREATE INDEX funding_roll_patron ON funding_roll (patron);
  CREATE INDEX funding_roll_pot ON funding_roll (pot);
  CREATE TABLE funding_holo (seq INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT, pot TEXT, holo INTEGER, epoch TEXT, date TEXT, receipt TEXT);
  CREATE INDEX funding_holo_party ON funding_holo (party);
  -- The sigma leg (R12, 2026-08-21): ordinary mint, source-tagged to the pot,
  -- with no liquid coin. Retired 2026-09-14 (nothing burns) and reads 0 for
  -- everyone; the table stands so an old row still surfaces under its own name.
  -- Its own table for what USED to be holo's reason too -- but unlike holo,
  -- this leg really does carry no coin, so keeping it out of a balance is still
  -- the law here. The ownership read counts it deliberately; no tense does.
  CREATE TABLE funding_keeping_mint (seq INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT, pot TEXT, n INTEGER, epoch TEXT, date TEXT);
  CREATE INDEX funding_keeping_mint_party ON funding_keeping_mint (party);
  -- payer is the receipt's own from: field, and it is the ONE place attribution
  -- lives: who paid, how many dollars, when. Everything downstream that names a
  -- patron reads it from here, through funding_roll's join on the receipt ref.
  CREATE TABLE pot_receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, pot TEXT, rail TEXT, usd REAL, date TEXT, receipt TEXT, payer TEXT);
  CREATE INDEX pot_receipts_pot ON pot_receipts (pot);
  CREATE TABLE pot_escrow (pot TEXT PRIMARY KEY, staked INTEGER);
  -- WHO staked, not only how much. pot_escrow's one integer answers "what does
  -- this pot hold"; it cannot answer "who put it there", which is the question
  -- an agent reading a fund actually asks before it stakes. Same rows, same
  -- netting, same drains as pot_escrow — foldFunding's escrow() helper writes
  -- both keys in one call, so the two can never disagree and sum(staked) per pot
  -- is pot_escrow.staked by construction. A staker netted to 0 is ABSENT: a closed
  -- position is not a stake, and absent == zero is the one representation here
  -- exactly as it is in pot_escrow.
  CREATE TABLE pot_stakers (pot TEXT, handle TEXT, staked INTEGER, PRIMARY KEY (pot, handle));
  CREATE TABLE funding_invalid (seq INTEGER PRIMARY KEY AUTOINCREMENT, row_kind TEXT, line TEXT, reason TEXT);
`;
