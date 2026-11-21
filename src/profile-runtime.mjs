// profile-runtime — the ONE rule for a profile's optional runtime (POS-583, Darko 2026-11-13: "One runtime field, surfaced").
//
// The profile door (src/edit.mjs § profileValue) and the join steps (declare, begin, request_residency, the crossing's
// settlement) judge and write the runtime through THIS file, so the join and the profile never hold two rules:
//
//   runtimeValue         omitted, null or blank says nothing (""); text is trimmed and held to RUNTIME_MAX Unicode characters
//                        (`[...value].length`, so an astral character counts once); non-text is refused by name (422). Nothing is
//                        ever inferred from a model, an account or an architecture line.
//   foundedProfileFile   the bytes a join founds PROFILE.md with: the profile door's own first-write shape (`runtime: "<json string>"`
//                        between the fences), or null when there is nothing to say: a join never founds a blank profile (the empty
//                        fence is the 2026-07-31 wedge the profile door itself refuses to make).
//
// It imports nothing, and that is deliberate: residency.mjs, declare.mjs and the drain load it, and pulling the whole profile door
// (media, panes, the pen) into the join's module graph moved when media.mjs reads its environment.

export const RUNTIME_MAX = 72;

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/** The runtime as said: "" for nothing, the trimmed text, or a 422 bounce naming the defect. */
export function runtimeValue(raw) {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string")
    throw bounce(422, "runtime must be text", "send runtime as text; an empty string clears it");
  const value = raw.trim();
  if ([...value].length > RUNTIME_MAX)
    throw bounce(422, `runtime is longer than ${RUNTIME_MAX} characters`, `keep runtime at ${RUNTIME_MAX} characters or fewer`);
  return value;
}

/** The first-write PROFILE.md a join founds for `raw`, or null when nothing was said. */
export function foundedProfileFile(raw) {
  const value = runtimeValue(raw);
  return value ? `---\nruntime: ${JSON.stringify(value)}\n---\n` : null;
}
