# The sandbox: a local Postmark for trying World mechanics

A whole office on your machine. It has a seeded town, crossings you run by hand, open media, and the World viewer pointed at it. Nothing in it can reach prod or dev. (POS-560, built for Darko and Wright.)

## Start it

From an office pool tree you have claimed (it uses that tree's own Postgres), in Git Bash or PowerShell:

    node tools/sandbox.mjs up

The first `up` builds the seed, which takes about 12 minutes, once. After that, `up` takes a few seconds. It stays in the foreground and prints:

- the office at `http://127.0.0.1:4590` (REST, and MCP at `/mcp`);
- the viewer at `http://127.0.0.1:4591/`.

If either port is taken, it picks a free one and tells you. Stop it with Ctrl-C, or with `node tools/sandbox.mjs down` from another terminal.

## What is in it

- **The real record.** The town and the world at this tree's clones: the law, the Keeping Works, every mark, and the Mists and their clearings. The engine and the ledger's checks run on what prod runs.
- **Three households of its own,** each with a parcel at the Town Centre's south edge:
  - `sb-lantern`: residents `sb-ash` and `sb-bram`, with the thing `sb-ash/a-bowl-of-candy`;
  - `sb-quill`: resident `sb-cleo`, with the thing `sb-cleo/a-lantern`;
  - `sb-moss`: resident `sb-dov`.

  The parcels sit at (200,−350), (300,−350) and (400,−350).
- **Its own stamp key.** The ledger is re-signed onto it, and nobody else's mail crosses.

## Try a mark

Act as a seeded resident with `as <handle> <tool> '<json>'`. The calls are the same ones a resident's agent makes.

    node tools/sandbox.mjs as sb-ash world                          # look around
    node tools/sandbox.mjs as sb-ash world '{"do":"take","args":{"thing":"sb-ash/a-bowl-of-candy"}}'
    node tools/sandbox.mjs as sb-dov world '{"do":"leave-mark","args":{"slug":"a-shed","kind":"sited","at":{"x":400,"y":-350},"extent":{"w":10,"h":10},"stamps":0,"body":"A little shed."}}'

Walk, take, give, drop, enter, exit and say are live: they happen at once. A new mark has to be settled first:

1. Leave it with `"stamps": 0` on your own ground. That puts it forward. Without `stamps` it stays a draft (not the town's canon), and you can put it forward later with `{"do":"stake","args":{"mark":"sb-dov/a-shed","stamps":0}}`.
2. Run a crossing (below).
3. It now stands in the world, and you can enter it with `{"do":"enter","args":{"mark":"sb-dov/a-shed"}}`.

A draft can't be entered before its crossing. `enter` reads only what has settled.

Other commands:

- **REST:** `call <handle> GET /world/walkers`.
- **Media:** `upload_media`. Put an image in the sandbox's town clone under `WHITE_PAGES/<handle>/` (`status` prints where the clone is). Then:

      as sb-ash upload_media '{"by":"sb-ash","image_path":"WHITE_PAGES/sb-ash/candy.png"}'

  The URL you get back looks like the town's media URL, but the bytes stay in the sandbox's folder, and the viewer shows them from there.
- **Your own agent as a resident:** `mcp-config sb-ash` prints an MCP server entry.

## Cross

    node tools/sandbox.mjs cross            # the whole crossing, about 4 minutes
    node tools/sandbox.mjs cross --settle   # only the world half, about 2 minutes
    node tools/sandbox.mjs cross --ferry    # only the town half: mail, the mint, the welcome

The crossing runs the box's own jobs in the box's order, through the dev rehearsal's steps:

1. the ferry and the keeping tick's mint, on the town;
2. the clearing, which closes the open window;
3. the settlement;
4. the keeper's bless.

After the bless, the sandbox's world moves to the blessed commit, and the store re-reads its law and graph. The office and the viewer then show the new world.

The crossing *number* is still the town clock's, so a hand crossing doesn't move the Mists' schedule.

## Look

    node tools/sandbox.mjs look --at 200,-350                 # what a resident standing there is told
    node tools/sandbox.mjs look --at 3850,-5500 --crossing 282 # the Spire, under the Mists on 10-31

This runs the world's own `tools/world-poc.mjs` on the sandbox's world. To see the map, open the viewer. It reads the sandbox office for everything live.

## Reset

    node tools/sandbox.mjs down     # or Ctrl-C in the up terminal
    node tools/sandbox.mjs reset    # about 10 seconds, back to the seed

The reset restores the store from its seed copy, puts both clones back on their seed tag, and empties media. `status` shows what is up and where things are. `drop` removes the sandbox entirely: its two databases (`sandbox`, `sandbox_seed`) and its folder (`<temp>/postmark-sandbox-<tree>`).

## Why it can't reach prod or dev

`up` refuses to start unless all of these hold:

- the store is this tree's own Postgres, and the database is `sandbox`;
- every URL in the office's environment is on this machine, and no path is a box path;
- the clones have no remote, and nothing pushes;
- the stamp key is the sandbox's own, not the town's;
- no real R2 credential is present.

Every process it starts also carries `tools/lib/sandbox-fence.mjs`. The fence:

- refuses any connection to a host that isn't this machine;
- makes servers listen on loopback only;
- writes the media endpoint's R2 uploads to the sandbox's folder.

Git is held to local files.

## What it reuses

It forks none of these:

- the dev rehearsal's local stand-in (`test/helpers/dev-target.mjs`);
- the dev freshen's re-sign (`tools/dev-ledger-resign.mjs`);
- the office's migrations, through `test/helpers/embedded-store.mjs`;
- the box's crossing jobs and the rehearsal's clearing, settlement and bless steps (`tools/dev-rehearsal.mjs`);
- the read eval's MCP caller and graph snapshot (`tools/read-eval/office.mjs`);
- the world's own spectator and `world-poc.mjs`.
