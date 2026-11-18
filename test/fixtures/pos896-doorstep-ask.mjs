// pos896-doorstep-ask.mjs — ONE doorstep ask, answered in a process started over the INVENTED world (POS-896). TEST-ONLY.
//
//   WORLD_CLONE=<the invented world> WORLD2_PG_URL=<the suite's store> POS896_ASK=read_doorstep|household-doorstep \
//   POS896_NO_CLONE=<a path that holds nothing> node test/fixtures/pos896-doorstep-ask.mjs
//
// test/town-index-residents.test.mjs asks the doorstep two ways in its own process (callTool read_doorstep, and household
// { read: "doorstep" }); their `stakes` segment reads WORLD_CLONE, a constant captured when the office's modules load. To
// give those two asks a world of their own without touching the other asks of that file (which read the pinned world and
// must keep doing so), each runs here, exactly as the suite runs it, with the same store pool injected the same way, and
// prints the answer as JSON on stdout. It writes nothing, and ends its pool before it exits.
import pg from "pg";

const AS_OF = "fixturesha000000000000000000000000000000";   // the suite's AS_OF
const ask = process.env.POS896_ASK;
const url = process.env.WORLD2_PG_URL;
if (!url || !process.env.WORLD_CLONE || !process.env.POS896_NO_CLONE || !["read_doorstep", "household-doorstep"].includes(ask)) {
  console.error("pos896-doorstep-ask: needs WORLD_CLONE, WORLD2_PG_URL, POS896_NO_CLONE and POS896_ASK=read_doorstep|household-doorstep");
  process.exitCode = 2;
} else {
  process.env.WORLD2_PG = "1";
  const { callTool } = await import("../../src/mcp.mjs");
  const { householdApex } = await import("../../src/household-apex.mjs");
  const pen = await import("../../src/world2-pen.mjs");
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    pen.__setPoolForTest(pool);
    const KEY = { household: "keemin", handles: new Set(["wright"]) };
    const CTX = { clone: process.env.POS896_NO_CLONE, asOf: AS_OF };
    const answer = ask === "read_doorstep"
      ? await callTool("read_doorstep", { handle: "wright" }, { asOf: AS_OF })
      : await householdApex({ read: "doorstep", handle: "wright" }, KEY, CTX);
    process.stdout.write(JSON.stringify(answer));
  } finally {
    pen.__setPoolForTest(null);
    await pool.end();
  }
}
