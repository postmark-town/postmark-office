// sandbox-fence.mjs — the local sandbox's fence: no host but this machine (POS-560).
//
// tools/sandbox.mjs loads this into every node process it starts (the office,
// the crossing's jobs, the viewer) with NODE_OPTIONS=--import, so it holds in
// grandchildren too. Two rules (and a server that names no host listens on
// loopback only, so nothing reaches in either), and nothing else changes:
//
//   1. NO HOST BUT THIS MACHINE. Every socket a process opens must go to a
//      loopback address. A connect to anything else (postmark.town, the box,
//      GitHub, R2) is destroyed with a named error before a byte leaves, and
//      fetch to such a host is refused the same way. The office's GitHub calls
//      already go to the sandbox's stub (GITHUB_API_URL), the clones have no
//      remote, and git is held to file:// by GIT_ALLOW_PROTOCOL; this is the
//      net under all of them, so a default nobody overrode cannot reach prod.
//
//   2. THE MEDIA ENDPOINT WRITES HERE. The office's media endpoint (POST /media,
//      upload_media) puts bytes to Cloudflare R2 (src/media.mjs § r2Put,
//      https://<account>.r2.cloudflarestorage.com/<bucket>/<key>).
//      In the sandbox that PUT is answered by this file: the bytes land at
//      SANDBOX_MEDIA_DIR/<key> and the office hands back its usual
//      https://media.postmark.town/media/… url, which the sandbox's viewer
//      serves from the same folder (/shelf/…). So media is open and nothing
//      is uploaded anywhere. The office's own code is unchanged.
//
// Inert unless SANDBOX_FENCE=1 (only the sandbox sets it).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import net from "node:net";
import { dirname, join, normalize, sep } from "node:path";

export const LOOPBACK = (host) => {
  if (host == null || host === "") return true; // node's default host is localhost
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h) || /^::ffff:127\.\d+\.\d+\.\d+$/.test(h);
};

export const R2_HOST = /\.r2\.cloudflarestorage\.com$/i;

export const refusal = (host) => Object.assign(new Error(`the sandbox reaches no host but this machine: refused ${host} (tools/lib/sandbox-fence.mjs)`), { code: "SANDBOX_FENCE" });

/** The local file an R2 object key lands at, or null for a key that would climb out of the folder. */
export function mediaFile(mediaDir, pathname) {
  // /<bucket>/<key>: the key is everything after the bucket
  const key = decodeURIComponent(pathname).replace(/^\/[^/]+\//, "");
  const file = normalize(join(mediaDir, key));
  return file.startsWith(normalize(mediaDir) + sep) ? file : null;
}

/** Answer one R2 request from the local folder: PUT writes, GET/HEAD reads. */
export async function answerR2(mediaDir, url, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const file = mediaFile(mediaDir, url.pathname);
  if (!file) return new Response("bad key", { status: 400 });
  if (method === "PUT") {
    const body = init.body == null ? Buffer.alloc(0) : Buffer.from(init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : init.body);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    return new Response(null, { status: 200 });
  }
  if (method === "GET" || method === "HEAD") {
    if (!existsSync(file)) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : readFileSync(file), { status: 200 });
  }
  return new Response(null, { status: 405 });
}

function install() {
  const mediaDir = process.env.SANDBOX_MEDIA_DIR || null;

  const realFetch = globalThis.fetch;
  globalThis.fetch = async function sandboxFetch(input, init = {}) {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (R2_HOST.test(url.hostname)) {
      if (!mediaDir) throw refusal(url.hostname);
      return answerR2(mediaDir, url, { method: init.method ?? input?.method, body: init.body });
    }
    if (!LOOPBACK(url.hostname)) throw new TypeError("fetch failed", { cause: refusal(url.hostname) });
    return realFetch(input, init);
  };

  // Under fetch, pg, http and every other client: the socket itself.
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function sandboxConnect(...args) {
    // net.connect() hands its normalized [options, cb] pair over as one array
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const opts = first && typeof first === "object" && !Array.isArray(first) ? first : null;
    const host = opts ? opts.host : (typeof first === "number" || /^\d+$/.test(String(first)) ? args[1] : undefined);
    const isPath = opts ? Boolean(opts.path) : (typeof first === "string" && !/^\d+$/.test(first));
    if (!isPath && typeof host === "string" && !LOOPBACK(host)) {
      const err = refusal(host);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return realConnect.apply(this, args);
  };

  // And nothing reaches in: a server that names no host (the office listens on
  // every interface by default) listens on this machine's loopback only.
  const realListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function sandboxListen(...args) {
    const first = args[0];
    if (first && typeof first === "object" && !Array.isArray(first) && first.port != null && first.host == null && first.path == null)
      args[0] = { ...first, host: "127.0.0.1" };
    else if ((typeof first === "number" || /^\d+$/.test(String(first ?? ""))) && typeof args[1] !== "string")
      args.splice(1, 0, "127.0.0.1");
    return realListen.apply(this, args);
  };
}

if (process.env.SANDBOX_FENCE === "1") install();
