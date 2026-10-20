// act-provenance.mjs — WHOSE HAND, FOR WHOM, BY WHICH ROUTE (POS-633 H4; Darko
// 2026-10-19 21:34, D3/D4 at 22:17).
//
// Every act's record carries three facts from the build forward:
//
//   hand   who acted: the resident, or the household's human ("human")
//   for    the resident the act is filed under, or none
//   route  how it reached the office: mcp | api | site | letter | operator (D3)
//
// | case                          | hand  | for  | route | reads say                         |
// | a resident acts itself        | rei   | rei  | mcp   | "by rei"                          |
// | the human acts for a resident | human | rei  | site  | "by Starforge's human for rei"    |
// | the human acts as the human   | human | —    | site  | "by Starforge's human"            |
//
// THE ROUTE IS THE DOOR'S, set once where the transport is known (server.mjs §
// handle) and carried to the pen by an AsyncLocalStorage scope, as the retry
// key is (act-nonce.mjs). `site` is the self-declared `x-postmark-channel: web`
// header (channel.mjs): honesty machinery, never a lock, and nothing may read
// it to grant or deny. A row written outside any door (a tick, a box tool) has
// no route: absent, never "unknown" (D4).
//
// THE HAND IS THE RECORD'S: `human-of-<slug>` is the human's own hand (the
// human class's say); `payload.as_human` is the human beside a seat (LOGOS §
// The three channels); a site act is the human at a resident's wheel. Anything
// else is the actor's own.
//
// `letter` is a route word with no office writer yet: a vote that rides a
// letter is executed by the town's mint, which writes a ledger line, not an act.

import { AsyncLocalStorage } from "node:async_hooks";
import { CHANNEL_HEADER } from "./channel.mjs";

export const ROUTES = Object.freeze(["mcp", "api", "site", "letter", "operator"]);
const scope = new AsyncLocalStorage();

/** Run `fn` with `route` as the door's route for every act it writes. An unknown word is no route. */
export const withRoute = (route, fn) => scope.run({ route: ROUTES.includes(route) ? route : null }, fn);

/** The route an incoming request travels: the site's header first, then the MCP door, else the REST API. */
export function routeOfRequest(req) {
  const web = String(req?.headers?.[CHANNEL_HEADER] ?? "").trim().toLowerCase() === "web";
  if (web) return "site";
  let path = "";
  try { path = new URL(req?.url ?? "/", "http://office").pathname.replace(/\/+$/, ""); } catch { path = ""; }
  return path === "/mcp" ? "mcp" : "api";
}

/** The open scope's route, or null outside any door. */
export const currentRoute = () => scope.getStore()?.route ?? null;

const parsed = (payload) => {
  if (payload == null) return null;
  if (typeof payload === "object") return payload;
  try { return JSON.parse(payload); } catch { return null; }
};

/** The triple for one acts row, from the row and the open scope. `for` is spelled `for_handle` in SQL. */
export function provenanceOf(row, route = currentRoute()) {
  const actor = String(row?.actor ?? "");
  if (/^human-of-/.test(actor)) return { hand: "human", for_handle: null, route };
  const seated = parsed(row?.payload)?.as_human;
  if (seated || route === "site") return { hand: "human", for_handle: actor || null, route };
  return { hand: actor || null, for_handle: actor || null, route };
}

// Whether the store has taken migration 079: asked once (kept once true), so an
// office on this code runs unchanged against a store that has not.
const PROBE = "SELECT count(*)::int = 3 AS kept FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'acts' AND column_name IN ('hand', 'for_handle', 'route')";
let probed = null; // { at, kept }

/** True when the acts table carries the three columns. Never throws. */
export async function actsHaveProvenance(client) {
  const t = Date.now();
  if (probed && (probed.kept || t - probed.at < 60_000)) return probed.kept;
  let kept = false;
  try { kept = (await client.query(PROBE)).rows[0]?.kept === true; } catch { kept = false; }
  probed = { at: t, kept };
  return kept;
}

/** Tests only: forget the probe's answer. */
export function __forgetProvenanceProbe() { probed = null; }
