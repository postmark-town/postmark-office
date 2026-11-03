// public-base.mjs — the office's own public API base, in ONE place (POS-777).
//
// A door's answer that tells a reader "or GET <path>" names an ABSOLUTE url,
// because a bare `/posts/<id>` is relative to the API yet reads like a site
// path: copied with the site host it 404s (postmark#4132). The base is the
// office's PUBLIC_BASE config (default https://postmark.town/api), read at
// call time so a test or a deploy that sets it is honoured.

export const DEFAULT_PUBLIC_BASE = "https://postmark.town/api";

/** The API base, no trailing slash: https://postmark.town/api */
export const publicBase = () => String(process.env.PUBLIC_BASE ?? DEFAULT_PUBLIC_BASE).replace(/\/+$/, "");

/** An absolute API url for a path ("/posts/x?class=bug" or "posts/x"). */
export const apiUrl = (path) => `${publicBase()}/${String(path).replace(/^\/+/, "")}`;
