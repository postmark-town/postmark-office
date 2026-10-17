// town-tables.mjs — the town index's tables and their columns, with no imports,
// so a reader of the shape (the store's ingest, a test's fixture town) need not
// load the derivation. town-index.mjs re-exports it.

/**
 * The tables, in the column order the store's town_* twins keep
 * (033_town_index.sql). `key` names the primary key for a keyed table; `seq`
 * marks the numbered tables, whose `seq` is the row's 1-based position in the
 * derivation.
 * `repo_log` has neither: it is append-only, one row per commit x file.
 */
export const TOWN_TABLES = Object.freeze({
  meta:                 { cols: ["key", "value"], key: ["key"] },
  residents:            { cols: ["handle", "json"], key: ["handle"] },
  letters:              { cols: ["id", "from_h", "to_h", "date", "thread", "box", "owner", "path", "json", "delivered_at"], key: ["id"] },
  threads:              { cols: ["root", "json"], key: ["root"] },
  bulletin:             { cols: ["slug", "json"], key: ["slug"] },
  ledger:               { cols: ["seq", "kind", "date", "id", "from_h", "to_h", "json"], seq: true },
  stamps:               { cols: ["handle", "balance", "mint_count", "staked"], key: ["handle"] },
  mail_state:           { cols: ["handle", "json"], key: ["handle"] },
  quest_progress:       { cols: ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"], key: ["handle"] },
  quest_standing:       { cols: ["handle", "json"], key: ["handle"] },
  repo_log:             { cols: ["sha", "committed_at", "author", "subject", "op", "path"] },
  regions:              { cols: ["id", "name", "json"], key: ["id"] },
  homes:                { cols: ["handle", "region", "json"], key: ["handle"] },
  pots:                 { cols: ["id", "json"], key: ["id"] },
  funding_roll:         { cols: ["seq", "patron", "pot", "usd", "date", "receipt", "holo"], seq: true },
  funding_holo:         { cols: ["seq", "party", "pot", "holo", "epoch", "date", "receipt"], seq: true },
  funding_keeping_mint: { cols: ["seq", "party", "pot", "n", "epoch", "date"], seq: true },
  pot_receipts:         { cols: ["seq", "pot", "rail", "usd", "date", "receipt", "payer"], seq: true },
  pot_escrow:           { cols: ["pot", "staked"], key: ["pot"] },
  pot_stakers:          { cols: ["pot", "handle", "staked"], key: ["pot", "handle"] },
  funding_invalid:      { cols: ["seq", "row_kind", "line", "reason"], seq: true },
});
