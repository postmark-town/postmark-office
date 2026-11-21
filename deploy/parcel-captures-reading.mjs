// parcel-captures-reading.mjs — A PARCEL THAT NEWLY TOOK IN AN OLDER FOREIGN MARK, ON THE KEEPER'S RECEIPT (WLD-224).
//
// Darko, 2026-11-20 15:48 EST: "isn't it just admit normally? and it gets flagged to the worldkeeper for coordination." The World
// admits the parcel and files the older mark under it as ever; its crossing report (tools/parcel-captures.mjs in the World) now
// says when that happened, as `parcel_captures: { checked, parcels_checked, events }`. This file maps that line onto the receipt the
// keeper already reads (GET /crossings/receipts returns the whole latest receipt), because a lint WARN only reaches stderr and a
// sweep key the composer does not name reaches nobody. It is a NOTE FOR COORDINATION: never an admission error, a refusal, a
// quarantine, a harm finding or a settlement status, and nothing here changes how a crossing succeeds or what it publishes.
//
// ABSENT IS NOT EMPTY, and an ordinary night stays exactly as it was (settlement-receipt-refused.test.mjs freezes the key list):
//   - a sweep that says nothing (a World that predates the check), or one that looked and found nothing taken in: no key at all;
//   - a sweep whose look FAILED (`checked: false`): `{ checked: false, why }`, so a blind night is not read as a quiet one;
//   - a sweep that found captures: `{ checked: true, parcels_checked, events_total, events }`, EVERY event, each whitelisted below.
// Until the World carries the check, no receipt has the key: delivery of the flag awaits both releases (World main, Office train).

const text = (v) => (typeof v === "string" && v ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);

/** One event, by name: both marks, both canonical households, who laid each and when, and the measured overlap. */
const eventOf = (e) => ({
  parcel: text(e?.parcel), parcel_household: text(e?.parcel_household), parcel_by: text(e?.parcel_by), parcel_laid: text(e?.parcel_laid),
  mark: text(e?.mark), mark_household: text(e?.mark_household), mark_by: text(e?.mark_by), mark_laid: text(e?.mark_laid), mark_tier: text(e?.mark_tier),
  overlap_m2: num(e?.overlap_m2), mark_area_m2: num(e?.mark_area_m2),
});

/** The receipt's `parcel_captures` for this sweep, or null when there is nothing to say. */
export function parcelCapturesOf(sweep) {
  const pc = sweep?.parcel_captures;
  if (!pc || typeof pc !== "object" || Array.isArray(pc)) return null;
  if (pc.checked === false) return { checked: false, why: text(pc.why) ?? "the crossing's look for a parcel taking in an older mark did not run" };
  const events = Array.isArray(pc.events) ? pc.events : [];
  if (!events.length) return null;
  return {
    checked: true,
    parcels_checked: num(pc.parcels_checked),
    events_total: events.length,
    events: events.map(eventOf),   // every one: the keeper coordinates on the marks and households named, and a total is not the identities past a cut
  };
}
