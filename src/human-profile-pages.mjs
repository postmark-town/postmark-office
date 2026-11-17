// human-profile-pages.mjs — the household's human's own form, as the office serves it (POS-721/c).
//
// RULED (Darko, 2026-11-17 00:31Z, POS-721/c): "Human only, like likeness". The profile is set through
// the office's own browser sign-in, on the likeness answer's road (src/oauth.mjs): /oauth/human?household=
// <slug>, GitHub, this form, POST /oauth/consent. These are its pages, in the likeness pages' look
// (likeness-pages.mjs § plainPage). Every value a page shows is escaped here.

import { plainPage } from "./likeness-pages.mjs";
import { HUMAN_PROFILE_CAPS } from "./human-profile.mjs";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const INPUT = "font:inherit;padding:.45em .6em;width:100%;max-width:28em;box-sizing:border-box";

const FIELDS = [
  ["town_name", "Your town name", "the name the town calls you by, e.g. DARKO"],
  ["short_line", "A short line", "one line about you, shown with your house"],
  ["pronouns", "Pronouns", "e.g. she/her, he/him, they/them"],
];

/**
 * The form, to the account the household's record binds and no one else. `profile` is the stored
 * `human_profile` (or null); each field is filled with what is set now, and an emptied field clears it.
 */
export function formPage({ login, houseName, profile = null, action, pendingId, nonce }) {
  const rows = FIELDS.map(([name, label, hint]) => `
    <p><label for="${name}"><strong>${esc(label)}</strong></label><br>
    <input id="${name}" name="${name}" type="text" maxlength="${HUMAN_PROFILE_CAPS[name] * 2}" value="${esc(profile?.[name] ?? "")}" style="${INPUT}"><br>
    <span class="muted">${esc(hint)}; up to ${HUMAN_PROFILE_CAPS[name]} characters.</span></p>`).join("");
  return plainPage("Your name in town", `
  <p class="who">Signed in as <strong>@${esc(login)}</strong>, the human of the household <strong>${esc(houseName)}</strong>.</p>
  <p>The town's reads name you as your household's human. Give yourself a town name and they say it, with your house beside it:
  "by DARKO (${esc(houseName)}) for &lt;resident&gt;". Everything here is public, on the town's record. It is never your real-world name, and nothing here asks for one.</p>
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="pending_id" value="${esc(pendingId)}">
    <input type="hidden" name="nonce" value="${esc(nonce)}">${rows}
    <p class="muted">Empty a field to clear it.</p>
    <div class="answer">
      <button class="yes" name="decision" value="save">Save</button>
      <button class="no" name="decision" value="cancel">Cancel</button>
    </div>
  </form>`);
}

/** After a save: what is set now, and whether the town's printed record has it yet. */
export function savedPage({ profile, rendered, login }) {
  const set = profile ? FIELDS.filter(([name]) => profile[name]).map(([name, label]) => `<li>${esc(label)}: <strong>${esc(profile[name])}</strong></li>`).join("") : "";
  return plainPage("Saved", `
  <p>Saved for <strong>@${esc(login)}</strong>.</p>
  ${set ? `<ul>${set}</ul>` : "<p>Nothing is set now: the town's reads name you by your house alone.</p>"}
  <p class="muted">${rendered ? "It is on the town's record now." : "It is kept, and reaches the town's printed record at the next crossing."}</p>`);
}
