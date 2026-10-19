// admin-role.mjs — THE TOWN ADMIN ROLE, DERIVED FROM GITHUB (WLD-21; Darko
// 2026-10-18 19:38, 19:51, 19:52, and 21:23 on the gap read's G1–G6).
//
// The law (world LOGOS/classes.md § Admin households): a household is an admin
// household when a GitHub account in its own registry entry (`households.
// accounts`, never a resident's pin) owns the postmark-town organisation. Every
// resident of an admin household acts with it, and it unlocks exactly three
// classes whose `makers` answers false: dungeon, stairs and portal-ground. The
// three names and the one check are the world's (tools/admin-makers.mjs), read
// here through the world's own tool loader, so they live in one place.
//
// ONE RECORD. Whether a household is admin is the role registry (roles.mjs:
// `roles`, the store's office_roles), role `admin`, keyed on the account's gh_id
// as every role is. Its ONE writer is `refreshAdmins` below, run at each
// settlement (tools/admin-refresh.mjs): one GitHub read of the org's owners,
// intersected with every house's accounts. The leave-mark door reads the record,
// the export prints it into the World (WORLD/households.json § admins), and no
// gate asks GitHub itself (19:52).
//
// NEVER THROUGH roleGate. With OFFICE_ROLE_GATES unset (every office), roleGate
// lets everyone through without opening the book, so admin read through it
// would make every household admin. Admin is read with roleCheck, which always
// opens the book and refuses on a book it cannot read.
//
// A READ THAT FAILS KEEPS THE LAST ANSWER (G4). GitHub unreadable, or an owner
// list that comes back empty (an organisation always has an owner, so empty is
// a token that cannot see them, never a fact), changes nothing and says
// UNVERIFIED. A revocation is a refresh that READ the owners and no longer
// found the account.

import { DEFAULT_ROLES_DB, rolesSchema, roleCheck, listRoles, grantRole, revokeRole, normalizeSubject } from "./roles.mjs";
import { openPaper } from "./paperwork.mjs";
import { resolveHouse, keyOfSlug, houseRows } from "./household-deriver.mjs";

export const ROLE_ADMIN = "admin";
/** The refresh's name in the role audit: the only writer of role `admin`. */
export const ADMIN_ACTOR = "github:postmark-town-owners";
export const ADMIN_ORG = "postmark-town";

const housesOf = (registry) => registry?.households ?? registry ?? {};
const idsOf = (rec) => (rec?.accounts ?? []).map((a) => normalizeSubject(a?.id)).filter(Boolean);

// ── the seam the suite sets (the world module, the book, the registry) ──────
let seam = null;
/** Tests only: `{ adminMakers, paper, rows }`, any of them; null clears. */
export function __adminSeam(deps) { seam = deps; paperPromise = null; }

let paperPromise = null;
/** The role book, read-only, opened once: the store when switched, else roles.db. null when it cannot be opened. */
async function adminPaper() {
  if (seam && "paper" in seam) return seam.paper;
  paperPromise ??= openPaper(DEFAULT_ROLES_DB, { readOnly: true, schema: rolesSchema }).catch((e) => {
    console.error(`[admin-role] the role book could not be opened (${String(e?.message ?? e).slice(0, 120)}); no household is admin until it can be`);
    paperPromise = null;
    return null;
  });
  return paperPromise;
}

/** The world's admin-makers module, at the freshest main; null when the world does not carry it yet. */
async function adminMakers() {
  if (seam && "adminMakers" in seam) return seam.adminMakers;
  try { return await (await import("./dynamic-entities.mjs")).worldToolModule("admin-makers.mjs"); }
  catch { return null; }
}

/** Is this exactly one of the classes admin unlocks? False when the world module cannot be read (the strict direction). */
export async function isAdminClass(klass) {
  const mod = await adminMakers();
  return typeof mod?.isAdminClass === "function" ? mod.isAdminClass(klass) === true : false;
}

/**
 * Is the household this resident stands in an admin household? Any account in
 * the house's own list holding role `admin` (G1). A resident the registry
 * cannot place, or a book that cannot be read, is not admin.
 */
export async function householdIsAdmin(handle) {
  const rows = seam && "rows" in seam ? seam.rows : await houseRows().catch(() => null);
  const paper = await adminPaper();
  if (!rows || !paper) return false;
  const { slug } = resolveHouse(handle, rows.registry, rows.pins);
  if (!slug) return false;
  for (const id of idsOf(housesOf(rows.registry)[slug]))
    if ((await roleCheck(paper, id, ROLE_ADMIN)).ok) return true;
  return false;
}

/** May this resident make an instance of `klass` by the admin role? (Asked only after `makers` said no.) */
export async function adminMakes(klass, handle) {
  return (await isAdminClass(klass)) && householdIsAdmin(handle);
}

/** G6's words, on explain's `makers` answer for the three classes. */
export const ADMIN_MAKERS_WORDS = "false: the town's, and admin households' (owners of the postmark-town GitHub organisation)";
export async function withAdminMakers(answer) {
  if (answer?.makers?.value !== false || !(await isAdminClass(answer.explains))) return answer;
  return { ...answer, makers: { ...answer.makers, who: ADMIN_MAKERS_WORDS } };
}

// ── the refresh: the role's one writer ──────────────────────────────────────

/**
 * The org's owners, from GitHub: `[{ login, id }]`. Throws on anything that
 * is not a readable, non-empty list (the caller keeps the last answer).
 */
export async function readOrgOwners({ token, apiBase = "https://api.github.com", fetchImpl = fetch, org = ADMIN_ORG }) {
  if (!token) throw new Error("no token to read the organisation's owners with");
  const owners = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetchImpl(`${apiBase.replace(/\/+$/, "")}/orgs/${org}/members?role=admin&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "postmark-admin-refresh" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for the owners of ${org}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`GitHub's answer for the owners of ${org} was not a list`);
    for (const m of rows) if (normalizeSubject(m?.id)) owners.push({ login: String(m.login ?? ""), id: Number(m.id) });
    if (rows.length < 100) break;
  }
  if (!owners.length) throw new Error(`GitHub listed no owners of ${org}: an organisation always has one, so this token cannot see them (it needs the org's Members: read)`);
  return owners;
}

/**
 * What the role should be, against what it is, and (with `apply`) the writes
 * that make it so. `owners` is readOrgOwners' list, or null when it could not
 * be read: then nothing moves and the receipt says UNVERIFIED.
 * Returns `{ verified, grant: [...], revoke: [...], keep: [...], applied, receipt }`.
 */
export async function refreshAdmins({ owners, registry, paper, apply = false, actor = ADMIN_ACTOR, note = null }) {
  const held = (await listRoles(paper, { role: ROLE_ADMIN })).map((r) => ({ subject: String(r.subject), login: r.login ?? null }));
  if (!owners) {
    const receipt = `admin role UNVERIFIED: the owners of ${ADMIN_ORG} could not be read${note ? ` (${note})` : ""}; the last answer stands: ${held.length ? held.map((h) => h.login ?? h.subject).join(", ") : "no admin household"}`;
    return { verified: false, grant: [], revoke: [], keep: held, applied: false, receipt };
  }
  const ownerIds = new Map(owners.map((o) => [normalizeSubject(o.id), o.login]));
  // every account a house lists that owns the org (G1: any account in the house's own list)
  const want = new Map();
  for (const [slug, rec] of Object.entries(housesOf(registry)))
    for (const a of rec?.accounts ?? []) {
      const id = normalizeSubject(a?.id);
      if (id && ownerIds.has(id)) want.set(id, { subject: id, login: a.login ?? ownerIds.get(id), house: keyOfSlug(slug) });
    }
  const heldIds = new Set(held.map((h) => h.subject));
  const grant = [...want.values()].filter((w) => !heldIds.has(w.subject));
  const revoke = held.filter((h) => !want.has(h.subject));
  const keep = held.filter((h) => want.has(h.subject));
  if (apply) {
    for (const g of grant)
      await grantRole(paper, { subject: g.subject, role: ROLE_ADMIN, actor, login: g.login, note: `owns ${ADMIN_ORG}; tied to ${g.house}` });
    for (const r of revoke)
      await revokeRole(paper, { subject: r.subject, role: ROLE_ADMIN, actor, note: `no longer an owner of ${ADMIN_ORG} on a house's own list` });
  }
  const names = (xs) => xs.map((x) => x.login ?? x.subject).join(", ") || "none";
  const receipt = `admin role ${apply ? "refreshed" : "checked (nothing written)"} against ${owners.length} owner(s) of ${ADMIN_ORG}: `
    + `grant ${names(grant)}; revoke ${names(revoke)}; keep ${names(keep)}`;
  return { verified: true, grant, revoke, keep, applied: apply, receipt };
}

/**
 * The admin households, as WORLD/households.json § admins prints them: the
 * `hh:<slug>` of every house whose own list holds an account with role
 * `admin`, sorted. `subjects` is the role's held gh_ids.
 */
export function adminHouseholdKeys(registry, subjects) {
  const held = new Set([...subjects].map(normalizeSubject).filter(Boolean));
  const out = new Set();
  for (const [slug, rec] of Object.entries(housesOf(registry)))
    if (idsOf(rec).some((id) => held.has(id))) out.add(keyOfSlug(slug));
  return [...out].sort();
}
