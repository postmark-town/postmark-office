// hang-watch.mjs — MEASUREMENT ONLY (POS-491), to be removed with the fix it
// measures. Two files hang on CI's Linux runners past the 180 s file timeout
// before their first test reports, and a hang inside a synchronous spawn
// freezes the file's own event loop, so no timer here can say where it is.
// This starts a watcher OUTSIDE this process: at `afterS` it prints this
// process's tree (state, wait channel, age, command line) and every
// descendant's open files to stderr, which the test runner carries into the
// file's TAP, and again 20 s later (stuck, or moving?). It exits quietly the
// moment this process is gone.
//
//   import { hangWatch } from "./helpers/hang-watch.mjs";
//   hangWatch("refresher-blocked", 120);
import { spawn } from "node:child_process";

export function hangWatch(label, afterS) {
  if (process.platform === "win32" || !process.env.CI) return;
  const pid = process.pid;
  const script = `
    exec 1>&2
    snap() {
    echo "== hang-watch ${label}: $1 s, pid ${pid} =="
    ps -eo pid,ppid,etimes,stat,wchan:32,args --forest
    kids() { for c in $(ps -o pid= --ppid "$1"); do echo "$c"; kids "$c"; done; }
    for p in ${pid} $(kids ${pid}); do
      echo "-- pid $p: $(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-300)"
      echo "   wchan $(cat /proc/$p/wchan 2>/dev/null) · $(grep -E '^State' /proc/$p/status 2>/dev/null)"
      ls -l /proc/$p/fd 2>/dev/null | sed 's/^/   /' | head -40
    done
    echo "== hang-watch ${label}: end =="
    }
    i=0
    while [ $i -lt ${afterS + 20} ]; do
      kill -0 ${pid} 2>/dev/null || exit 0
      [ $i -eq ${afterS} ] && snap $i
      sleep 1; i=$((i+1))
    done
    snap $i
  `;
  const w = spawn("sh", ["-c", script], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  w.unref();
}
