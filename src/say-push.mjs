// say-push.mjs — THE WAITERS: a listen that waits for the next voice, and a
// stream of the same room deltas for the page (POS-265, the second half).
//
// The Snug night, measured (docs/2026-09-27/rail/pos-265): forty agents
// lingering at a minute each re-bought the room forty times a minute, and a
// voice still reached them up to a minute late. The delta (voices.mjs § THE
// DELTA) made each call small. This makes the calls few: a caller who passes
// `since` and `wait` is answered the moment a new voice lands in its earshot,
// or with an empty answer at the deadline — never more than WAIT_MAX_S later.
//
// ── ONE ROOM PER VOICE, NEVER ONE PER CONNECTION ────────────────────────────
//
// A waiter is an ear (where it stood when it began waiting), a cursor and a
// way to answer. When a voice lands, this module builds ONE snapshot of the
// room at that instant (voices.mjs § THE ROOM, ONCE PER INSTANT: every audible
// voice with the point it is heard from, and the record's clusters) and hands
// it to every waiter. Each ear then does its own arithmetic — is any of those
// points within my earshot, newer than my cursor — which is a distance test,
// not a derivation. Who is here BY POSITION is read once for all the ears that
// woke, from the kept positions (POS-264), through `nearbyMany`. Voices that
// land in the same turn share one fan-out.
//
// So fifty waiters cost one room per voice. `voices.room.stats` counts it, and
// the falsifier (test/say-push.test.mjs) holds the count.
//
// ── WHERE A WAITER STANDS (POS-887) ─────────────────────────────────────────
//
// A waiter opens in a room (the dungeon room its reader is entered in, or the
// open), and it is served only there: hearing stops at a room's walls, both
// ways (voices.mjs § heardBy, WLD-74). So before it serves anyone it reads where
// its reader stands NOW, from the same `standing` a listen uses, for the body it
// opened with (`standAs`, which is not always the handle: the human stands
// beside a housemate). A reader who has left that room, or whose place cannot
// be read, has the waiter ended rather than served: a wait answers empty at
// once, a stream closes its connection, and the ordinary reconnect buys the room
// they stand in now. In the same room the ear walks with its reader (position
// and boat are refreshed), so an answer is built from where they are.
//
// The read is made after the snapshot it serves, so a waiter is never served a
// voice on a standing older than that voice; and that holds for a stream's FIRST
// event too: its room is one snapshot taken before the read that authorizes it,
// and a reader who has left by then is sent no first event at all. A room that
// cannot be told (the world or the enter ledger unreadable) is not the open: the
// waiter is refused at the open and ended after it (voices.mjs `standing`, strict).
//
// A reader who has walked is found when a voice reaches the ear they left, or at
// the stream's next beat. A beat refreshes WHERE THE EAR STANDS; it delivers
// nothing. What a reader walked into earshot of is served with the next voice that
// reaches that ear (a wait is bound by its own 25 s deadline and its re-call's
// arrival check), so a moved ear can wait for another voice. That is a delay in
// lawful hearing, not a reach.
//
// A WAITER HOLDS A CONSTANT AMOUNT OF WORK: the run in progress and one pending
// slot (the newest snapshot). A standing read that never settles cannot grow a
// queue, and the pending slot is taken up when the read resumes.
//
// It lives in the process that holds the voices log. A wait is a listen, but
// it is woken by a say, so it must be served where the say lands — a reader
// on another thread would wait for a voice it can never hear.

export const WAIT_MAX_S = 25;
export const STREAM_BEAT_MS = 15_000;
// A handle may hold a few open ears (a client retrying, the page and an agent
// at once), not a crowd of them; and the office holds a bounded number in all.
export const WAITERS_PER_HANDLE = 4;
export const WAITERS_MAX = 2000;

const bounce = (defect, hint) => ({ error: "bounce", defect, hint });

/**
 * `voices` is a `createVoices()` store (its `room`). `nearbyMany(ears, t)`
 * answers who is within earshot of each ear BY POSITION, from one read, as an
 * array of handle lists (a null entry: presence is not deriving, the same null
 * `nearby` answers) — or null when it cannot, and then each woken ear asks
 * `nearby` itself, which the stats count.
 */
export function createSayPush({
  voices,
  nearbyMany = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  defer = (fn) => setImmediate(fn),
} = {}) {
  const room = voices.room;
  const waiters = new Set();
  const stats = { fanouts: 0, woken: 0, timed_out: 0 };
  let pending = null;

  room.onLanded(() => {
    if (pending || waiters.size === 0) return;
    pending = new Promise((resolve) => defer(() => fanout().catch((e) => {
      console.error(`[say-push] a fan-out tripped (${String(e?.message ?? e).slice(0, 160)}) — the waiters answer at their deadline`);
    }).finally(resolve)));
  });

  async function fanout() {
    pending = null; // a voice landing while this runs schedules the next one
    if (waiters.size === 0) return;
    const t = room.now();
    const snap = await room.snapshot(t);
    stats.fanouts += 1;
    // The cheap cut, by where each ear last stood: whom this room could reach.
    // `serve` then reads where each of them stands now, before anything is sent.
    const due = [...waiters].filter((w) => room.heard(w.here, snap, w.since).length > 0);
    if (due.length === 0) return;
    const ears = due.map((w) => ({ at: w.here.at, aboard: Boolean(w.here.aboard), room: w.here.room ?? null }));
    let lists = null;
    if (nearbyMany) {
      try { lists = await nearbyMany(ears, t); }
      catch { lists = null; }
    }
    await Promise.all(due.map((w, i) => serve(w, snap, t, Array.isArray(lists) ? { ear: ears[i], list: lists[i] ?? null } : null)));
  }

  /**
   * One ear, kept in `waiters` until it ends. `end()` is the single way out and
   * is safe to reach twice; its hooks run once (the stream's connection hangs
   * its own on it). The caller adds `deliver(reply)` and `leave(standing)`.
   * `asked` counts the standing reads started and `applied` the newest one
   * kept, so a slow older read cannot overwrite a newer one.
   *
   * THE WORK A WAITER HOLDS IS BOUNDED (POS-887): `busy` is the one run in
   * progress and `next` the ONE request that arrived meanwhile, the newest
   * snapshot (an older one's voices are all in it). Nothing is queued per
   * arrival, so a read that never settles holds a constant amount, and `end`
   * clears it. `fail(e)` is what a throw while serving does: end the waiter.
   */
  function watcher({ handle, standAs, here, since }) {
    const w = { handle, standAs, here, since, roomAt: here.room ?? null, ended: false, hooks: [], busy: null, next: null, asked: 0, applied: 0 };
    w.fail = (e) => {
      console.error(`[say-push] serving a waiter tripped (${String(e?.message ?? e).slice(0, 160)}) — it is ended`);
      w.end();
    };
    w.end = () => {
      if (w.ended) return;
      w.ended = true;
      w.next = null; // pending work is not kept past the end
      waiters.delete(w);
      for (const f of w.hooks.splice(0)) {
        try { f(); } catch { /* one hook failing must not strand the rest */ }
      }
    };
    return w;
  }

  /**
   * Where `w`'s reader stands now, made fresh for every caller: a read already
   * under way began before this caller's need and may predate the reader's move,
   * so none is shared. Answers the standing while the watcher is still in the
   * room it opened in; otherwise ends it (`leave`) and answers null, as it does
   * for a watcher already ended, a reader the world can no longer place, and a
   * read that trips. No old room is ever assumed in their place.
   */
  async function stand(w) {
    if (w.ended) return null;
    const mine = ++w.asked;
    let now = null;
    try { now = await room.standing(w.standAs, { strict: true }); } catch { now = null; } // strict: a room that cannot be told ends it, it is never read as the open
    if (w.ended) return null; // ended while the read was out: a close, or another look that found the reader gone
    if (!now || now.bounce || (now.room ?? null) !== w.roomAt) { w.leave(now); return null; }
    if (mine > w.applied) { w.applied = mine; w.here = now; }
    return now;
  }

  /**
   * One watcher's answer to the voices in `snap`, built from where its reader
   * stands now. A watcher is served one request at a time, so overlapping
   * fan-outs and the arrival check cannot both build from the same cursor and
   * hand the same voice over twice, and the cursor only moves forward. A request
   * that arrives while one is running is NOT queued: it replaces the one pending
   * slot (the newest snapshot holds the older's voices), and the run takes it up
   * when it finishes, so a voice that landed during a slow read is still
   * considered without another voice having to unstick it. `asked` is the
   * batch's presence answer for the ear it was read for; it is used only while
   * the reader still stands at that ear, else the reply reads its own.
   */
  async function attempt(w, { snap, t, asked }) {
    const here = await stand(w);
    if (!here || room.heard(here, snap, w.since).length === 0) return;
    const sameEar = asked && asked.ear.at.x === here.at.x && asked.ear.at.y === here.at.y && asked.ear.aboard === Boolean(here.aboard);
    const r = await room.reply(w.handle, here, t, w.since, { snap, ...(sameEar ? { presentIn: asked.list } : {}) });
    if (w.ended) return; // closed while the reply was built: nothing is sent after the end
    stats.woken += 1;
    w.deliver(r);
  }

  function serve(w, snap, t, asked = null) {
    if (w.ended) return Promise.resolve();
    if (w.busy) { w.next = { snap, t, asked: null }; return Promise.resolve(); } // coalesced into the one pending slot
    const run = (async () => {
      let req = { snap, t, asked };
      while (req && !w.ended) {
        try { await attempt(w, req); } catch (e) { w.fail(e); return; }
        req = w.next;
        w.next = null;
      }
    })().finally(() => { w.busy = null; w.next = null; });
    w.busy = run;
    return run;
  }

  function admit(handle) {
    if (waiters.size >= WAITERS_MAX)
      return bounce("the office is holding as many open ears as it keeps",
        `call again without wait: (a plain listen), or in a moment — the office holds at most ${WAITERS_MAX} waiting listens at once`);
    let mine = 0;
    for (const w of waiters) if (w.handle === handle) mine += 1;
    if (mine >= WAITERS_PER_HANDLE)
      return bounce(`${handle} already has ${mine} open ears`,
        `a resident may hold ${WAITERS_PER_HANDLE} waiting listens or streams at once — close one, or listen without wait:`);
    return null;
  }

  const whereOf = (here) => ({ place: here.place, x: Math.round(here.at.x), y: Math.round(here.at.y), ...(here.aboard ? { aboard: true } : {}) });

  /**
   * THE LONG-POLL. `since` is required (a wait answers "what is new", and the
   * first call buys the room); `waitMs` is the caller's, already held to
   * WAIT_MAX_S by `waitMsOf`. Answers the say's
   * own delta the moment a new voice lands in earshot, or an empty answer at
   * the deadline with the cursor unmoved. A reader who stops standing in the
   * room it began in is answered the same empty way at once.
   */
  async function wait(handle, { standAs = handle, since, waitMs } = {}) {
    const t0 = room.now();
    const here = await room.standing(standAs, { strict: true }); // a room that cannot be told refuses the wait, it does not open it in the open
    if (here.bounce) return here.bounce;
    const refused = admit(handle);
    if (refused) return refused;
    room.listened(handle, here, t0);
    return new Promise((resolve, reject) => {
      let timer = null;
      const w = watcher({ handle, standAs, here, since });
      const finish = (body) => {
        w.end();
        clearTimer(timer);
        resolve({ ...body, waited_ms: room.now() - t0 });
      };
      w.deliver = finish;
      w.fail = (e) => { w.end(); clearTimer(timer); reject(e); }; // a throw while serving ends the wait and is the caller's error, as a plain listen's would be
      w.leave = (now) => finish({
        where: whereOf(now?.at ? now : w.here), voices: [], spoke: false, latest: since,
        note: "you no longer stand where this listen began, or where you stand could not be read — call again with the same since (your cursor has not moved) to listen from where you stand now",
      });
      // Registered BEFORE the arrival check, so a voice landing while the
      // check reads the room is not lost between the two.
      waiters.add(w);
      timer = setTimer(() => {
        if (w.ended) return;
        w.end();
        stats.timed_out += 1;
        resolve({
          where: whereOf(w.here), voices: [], spoke: false, latest: since,
          waited_ms: room.now() - t0,
          note: `nothing new within earshot in ${Math.round(waitMs / 1000)}s — call again with the same since (your cursor has not moved). The room's lists ride with the next voice, or on a call without wait:`,
        });
      }, waitMs);
      // THE ARRIVAL CHECK costs a room only when the log holds a voice newer
      // than the cursor — otherwise there is nothing this ear could have missed.
      if (room.latestAt() > since) {
        (async () => {
          const t = room.now();
          const snap = await room.snapshot(t);
          if (!w.ended) await serve(w, snap, t);
        })().catch((e) => w.fail(e));
      }
    });
  }

  /**
   * THE STREAM, for the page. `send(reply)` is called with the room as a
   * say-read answers it (the full room without `since`, the delta with it),
   * then with each delta as voices land in earshot; the cursor advances with
   * each. Returns `{ close, beat, onEnd }` or a bounce. `beat()` looks at the
   * reader again and keeps the ear counted as present where they stand now,
   * without reading the room; it answers whether the stream is still open.
   * `onEnd(fn)` runs `fn` once when the stream ends, however it ends, so the
   * connection can end with it. A reader who stops standing in the room the
   * stream began in has it ended, and reconnects to the room they stand in.
   */
  async function stream(handle, { standAs = handle, since = null } = {}, send) {
    const t = room.now();
    const here = await room.standing(standAs, { strict: true }); // a room that cannot be told refuses the stream, it does not open it in the open
    if (here.bounce) return here.bounce;
    const refused = admit(handle);
    if (refused) return refused;
    room.listened(handle, here, t);
    const w = watcher({ handle, standAs, here, since });
    w.deliver = (r) => {
      if (Number.isFinite(r?.latest)) w.since = r.latest;
      send(r);
    };
    w.leave = () => w.end();
    try {
      // THE FIRST EVENT IS BUILT FROM ONE SNAPSHOT, TAKEN BEFORE THE READ THAT
      // AUTHORIZES IT (POS-887). The snapshot is the room as it stands (voices,
      // and the record's clusters, which are not bound by the instant); the
      // standing read after it says whether this reader is still where the
      // stream opened. Then the reply is dressed from THAT snapshot and no
      // newer one, so no voice spoken after the reader left can reach it in its
      // record, its count or its cursor. A reader who has left, cannot be placed
      // or whose room cannot be told gets NO first event: the stream ends and
      // they reconnect to the room they stand in. (This is a lawful snapshot
      // read, not atomic delivery: a reader who leaves after the check is in the
      // same position as one who leaves while a frame is on the wire.)
      const tSnap = room.now();
      const snap = await room.snapshot(tSnap);
      const now = await stand(w);
      if (now) {
        const first = await room.reply(handle, now, tSnap, since, { snap });
        if (!w.ended) {
          if (Number.isFinite(first?.latest)) w.since = first.latest;
          // The first event is sent BEFORE the ear joins the fan-out, so a voice
          // landing while it is read cannot overtake it and move the cursor back;
          // a voice that landed in that gap is caught by the arrival check below,
          // which stands the reader again before it serves them.
          send(first);
          waiters.add(w);
          if (room.latestAt() > w.since) {
            const t1 = room.now();
            const snap1 = await room.snapshot(t1);
            if (!w.ended) await serve(w, snap1, t1);
          }
        }
      }
    } catch (e) {
      w.end(); // nothing the stream registered outlives a throw while it opened
      throw e;
    }
    return {
      close: () => w.end(),
      onEnd: (fn) => { if (w.ended) fn(); else w.hooks.push(fn); },
      beat: async () => {
        const now = await stand(w);
        if (!now || w.ended) return false;
        room.listened(handle, now, room.now());
        return true;
      },
    };
  }

  return {
    wait, stream,
    settled: () => pending ?? Promise.resolve(),
    stats,
    get open() { return waiters.size; },
  };
}

/**
 * Parse a caller's `wait` (seconds). Absent → null. Refused, never trimmed:
 * a wait past the cap would be answered sooner than asked, silently.
 */
export function waitMsOf(args = {}) {
  if (args.wait == null) return { waitMs: null };
  const s = Number(args.wait);
  if (!Number.isFinite(s) || s <= 0 || s > WAIT_MAX_S)
    return { bounce: bounce(`wait must be a number of seconds above 0 and at most ${WAIT_MAX_S}`,
      `wait: holds a listen open until a new voice lands in earshot, for up to ${WAIT_MAX_S} seconds — pass since: with it, and call again when it answers`) };
  if (String(args.text ?? "").trim())
    return { bounce: bounce("a wait is a listen", "speak without wait:, then wait on your next call with the reply's `latest` as since:") };
  if (!Number.isFinite(Number(args.since)) || args.since == null)
    return { bounce: bounce("wait needs since", "a wait answers what is NEW since your cursor — pass the `latest` stamp from your previous reply as since: (your first call, without wait, buys the room)") };
  return { waitMs: Math.round(s * 1000) };
}

/**
 * Serve one stream as Server-Sent Events. `open(send)` is `stream(...)` bound
 * to the caller; it answers `{ close, beat, onEnd }` or a bounce, which is
 * written as the ordinary JSON refusal before any event. Each event is
 * `event: room` with the reply as its data; a comment line every STREAM_BEAT_MS
 * keeps proxies from closing an idle room and keeps the ear counted as present,
 * once the stream has looked again at where its reader stands.
 *
 * The response ends, and its beat stops, when the client goes, when the
 * response fails, and when the stream ends itself (its reader left the room it
 * began in). Any of them may come twice, or before `open` has answered; nothing
 * is written after the end.
 */
export async function serveSayStream(req, res, open, { beatMs = STREAM_BEAT_MS, onBounce } = {}) {
  let started = false;
  let over = false;
  let opened = null;
  let beat = null;
  const head = () => {
    if (started) return;
    started = true;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
  };
  const send = (r) => {
    if (over) return;
    head();
    res.write(`event: room\ndata: ${JSON.stringify(r)}\n\n`);
  };
  const finish = () => {
    if (over) return;
    over = true;
    clearInterval(beat);
    if (!opened) return; // gone before the stream opened: it is closed the moment it does
    opened.close();
    head(); // a stream that ends before its first event still ends as a stream
    res.end();
  };
  req.on("close", finish);
  res.on("error", finish);
  const got = await open(send);
  if (got?.error) {
    if (!over) onBounce(got);
    return;
  }
  opened = got;
  if (over) { opened.close(); return; }
  let looking = false;
  beat = setInterval(async () => {
    if (looking || over) return; // one look at the reader at a time, never a pile of them
    looking = true;
    try { if ((await opened.beat()) && !over) res.write(": beat\n\n"); }
    catch { finish(); }
    finally { looking = false; }
  }, beatMs);
  opened.onEnd(finish);
}
