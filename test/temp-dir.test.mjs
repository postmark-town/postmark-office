// temp-dir.test.mjs — the teardown race's two guards (POS-419, 2026-10-09; helpers/temp-dir.mjs).
//
// Four files went red on CI in one day with `ENOTEMPTY … rmdir '<scratch>/.git/objects'`:
// a child still writing into the folder while the test removed it. On Linux that child
// is git's own detached gc/maintenance, so the helper makes this process's git run it
// in the foreground; and a child the test holds is waited for before the removal.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, removeTempDir } from "./helpers/temp-dir.mjs";

test("git, and every child that inherits this env, runs its auto maintenance in the foreground", () => {
  const read = (k) => execFileSync("git", ["config", "--get", k], { encoding: "utf8" }).trim();
  assert.equal(read("gc.autoDetach"), "false");
  assert.equal(read("maintenance.autoDetach"), "false");
});

// A child that writes into .git/objects for 400 ms after the test is done with the
// folder: what a detached `git gc --auto` does on Linux. A plain recursive rmSync
// loses this race nearly every time (49 of 50 rounds on the operator machine).
const WRITER = `const fs=require("fs"),p=require("path");const d=process.argv[1];const end=Date.now()+400;let i=0;
while(Date.now()<end){try{fs.mkdirSync(p.join(d,"pack"),{recursive:true});fs.writeFileSync(p.join(d,"pack","tmp_"+(i++)),"x".repeat(512));}catch{}}`;

test("removeTempDir waits for a child still writing into the folder, then removes it whole", async () => {
  for (let round = 0; round < 5; round++) {
    const dir = tempDir("temp-dir-race-");
    const objects = join(dir, ".git", "objects");
    for (let i = 0; i < 20; i++) { mkdirSync(join(objects, `o${i}`), { recursive: true }); writeFileSync(join(objects, `o${i}`, "x"), "x"); }
    const writer = spawn(process.execPath, ["-e", WRITER, objects], { stdio: "ignore" });
    await new Promise((ok) => setTimeout(ok, 60));
    try {
      await removeTempDir(dir, { children: [writer] });
      assert.equal(existsSync(dir), false, `round ${round}: the folder is gone`);
    } finally {
      if (writer.exitCode === null) await new Promise((ok) => writer.on("exit", ok));
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});
