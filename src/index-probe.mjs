// index-probe.mjs — THE WRITE PATH'S QUESTIONS OF THE INDEX (POS-268, group 4).
//
// The doors that write ask the town index four small things, synchronously and
// deep inside checks that were written sync: is this handle a resident (the
// recipient check, the join and declare desks, the key desk, the berth desk,
// the harbor stamp), is this a letter id (a thread, a duplicate), which handles
// a GitHub login is bound to (the sign-in's household), and a resident's
// mail_state row (the threadless reply hint). Each was a line of SQL on
// office.db, and each out-of-process pen (declare-exec, join-bind-exec, the
// earpiece's deliverer, the drain) opened office.db to ask it.
//
// A PROBE answers the same four questions: the store's (town-index-store.mjs
// § probeOver), a snapshot of its resident handles, letter ids and GitHub
// lines, read once per store head and held here by the process that loaded it.
// office.db's own probe went with office.db (POS-656).
//
// Every check still takes its `db` argument and asks `probeOf(db)`: a probe
// handed in is itself, and anything else is the store's held probe. A process
// that has not loaded the store's snapshot yet holds the REFUSING probe, whose
// every question throws the store's 503 in the bounce vocabulary each check
// already throws. No imports: the checks that use this sit under the store.

// The store's words when it cannot answer. town-index-store.mjs § UNREACHABLE is
// built from these; they live here because that module imports the checks that
// import this one.
export const UNREACHABLE_DEFECT = "the office's town index (the store) cannot be reached — nothing was read";
export const UNREACHABLE_HINT = "this door reads the store (TOWN_INDEX_READS=store); ask again shortly, and it answers when the store does";
const unreachable = () => { const e = new Error(UNREACHABLE_DEFECT); Object.assign(e, { code: 503, field: null, defect: UNREACHABLE_DEFECT, hint: UNREACHABLE_HINT }); return e; };

/** Is this the refusing probe's 503? A door that answers its own 500 answers this one as itself. */
export const isUnreachable = (e) => e?.code === 503 && e?.defect === UNREACHABLE_DEFECT;

/** The probe of a process whose store snapshot is not loaded: every question is the 503. */
export const REFUSING = Object.freeze({
  hasResident: () => { throw unreachable(); },
  hasLetter: () => { throw unreachable(); },
  loginStamp: () => { throw unreachable(); },
  loginRows: () => { throw unreachable(); },
  mailStateJson: () => { throw unreachable(); },
});

let held = null; // the store's probe this process last loaded (town-index-store.mjs sets it)
export const holdStoreProbe = (p) => { held = p; };
export const heldStoreProbe = () => held ?? REFUSING;

/**
 * The probe a check asks: a probe handed in (a door that loaded one row for
 * the call, or a test's `probeOver`) is itself; anything else is the store's
 * held probe. Never office.db, which is gone (POS-656).
 */
export function probeOf(x) {
  if (x != null && typeof x.hasResident === "function") return x;
  return heldStoreProbe();
}
