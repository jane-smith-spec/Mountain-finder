# Deploying Mountain Finder

`npm run build` produces a bundle that **cannot find terrain anywhere**. That is
deliberate — which square degrees of the planet a deployment ships is not the
bundler's decision — but it means the build is not, on its own, deployable. This
document is the missing step.

A deployment is **one static directory**. There is no server, no API key and no
runtime dependency on anybody else's service: decision D7 (MISSION.md) makes
elevation an acquisition-time dependency, and the browser only ever fetches
files from the app's own origin.

```
dist/
  index.html                       vite build
  assets/index-*.js  index-*.css   the app — peak data is compiled INTO the JS
  terrain/
    manifest.json                  the index HttpTerrainStore reads first
    tiles/N45E007.hgt              whole 1° SRTM1 tiles          (25.93 MB each)
    tiles/N45E007.hgt.gz           optional precompressed sibling (16.35 MB)
    windows/gornergrat-window.i16be  committed real-SRTM case windows
  peaks/<region>/index.json        imported Overture peak cells — staged, and
  peaks/<region>/cells/N45E007.json  inert until the app fetches them (see below)
  ATTRIBUTION.txt                  generated from the staged data's citations
```

## Producing it

```bash
npm run fetch:tiles -- N45E007 N46E007        # acquisition: the only network step
npm run build                                 # typecheck + bundle
npm run package:deploy -- --gzip              # assemble dist/terrain and dist/peaks
```

`scripts/package-deploy.ts` stages whatever terrain is already on disk —
`data/tiles/*.hgt` and the committed windows in `fixtures/tiles/cases/` — using
the *same* index builder the dev server uses (`buildTerrainManifest` in
`scripts/terrain-server.ts`), so a deployment serves exactly what `npm run dev`
served. Synthetic test tiles are excluded there and therefore here: invented
mountains at real coordinates is the failure mode this project exists to avoid.

Options:

| Flag | Effect |
|---|---|
| `--out <dir>` | build directory to package into (default `dist`) |
| `--tiles N45E007,N46E007` | stage only these whole tiles |
| `--no-tiles` | case windows only — a 1.45 MB deployment |
| `--no-windows` / `--no-peaks` | leave those out |
| `--gzip` | also write `.gz` siblings for every grid |
| `--copy` | real copies instead of hard links |

Files are hard-linked by default, so packaging 130 MB of tiles costs no disk and
no time. Use `--copy` if your upload step follows inodes rather than content.

The script refuses to stage a grid whose byte length disagrees with the geometry
the index claims for it. A truncated `.hgt` is a plausible-looking grid of the
wrong shape; caught here it is a build failure, caught in a browser it is a
wrong horizon.

## What it costs

Measured, not estimated, on the tiles in this repository (SRTM1, 3601 × 3601
int16 = 25 934 402 bytes per 1° tile). "Wire" is gzip level 6.

| Deployment | Files | On disk | On the wire |
|---|---|---|---|
| Case windows only (`--no-tiles`) | 4 windows | 1.45 MB | 0.79 MB |
| The four ground-truth viewpoints as whole tiles | N45E007, N37W122, N47W123, N56W006 | 103.74 MB | 43.29 MB |
| This repository's five tiles + the windows | 9 grids | 131.13 MB | 60.16 MB |
| The Alps, N43–N48 × E004–E016 | 78 tiles | 2 022.88 MB | ≈ 1 275 MB |

Per-tile, the numbers vary with how mountainous the tile is — flat and sea
compress well:

| Tile | Raw | gzip -6 | Ratio |
|---|---|---|---|
| N45E007 (Zermatt) | 25.93 MB | 16.35 MB | 63.0 % |
| N46E007 (Bernese Alps) | 25.93 MB | 16.08 MB | 62.0 % |
| N37W122 (San Francisco Bay) | 25.93 MB | 10.08 MB | 38.9 % |
| N56W006 (Hebrides, mostly sea) | 25.93 MB | 8.98 MB | 34.6 % |
| N47W123 (Puget Sound) | 25.93 MB | 7.88 MB | 30.4 % |

The Alps row is a box, not a mask: 6 × 13 whole degrees around the Alpine
Convention perimeter, gzip estimated at the 63 % ratio measured on its own
alpine tiles. A real Alpine deployment would drop the lowland corners and land
nearer 1.3 GB on disk. The unit to budget with is **25.93 MB / 16.35 MB per
mountainous degree square**.

**The windows-only row is a demo, not a deployment.** `--no-tiles --no-peaks`
produces a complete working app in 1.77 MB — checked: served statically, the
Gornergrat photo still renders `1 peak labelled: Matterhorn`. But those windows
were cut to the terrain each *acceptance case* turns on, not to the app's 30 km
sweep: the Gornergrat window is 361 × 1009 samples, about 11 km × 22 km. Rays
run off the edge of it, and a ridge outside the cut cannot occlude anything, so
this configuration can report a summit **visible** that a whole tile would show
as hidden. Ship it to demo the pipeline; ship tiles to be right.

**What one visitor downloads is not that total.** `selectTerrainGrid` picks the
single largest grid covering the viewpoint, so a session costs *one grid*: 16.35
MB gzipped for an alpine tile, 0.47 MB if the deployment ships only the tuned
case window. Nothing else is fetched — the peak database is already inside the
302 KB JS bundle.

## Serving it

Any static host. Three things are worth configuring:

1. **Precompression.** `--gzip` writes `foo.hgt.gz` next to `foo.hgt`. Serve it
   for requests that accept gzip, with `Content-Encoding: gzip`, and the browser
   inflates it before the app sees a byte. `HttpTerrainStore` checks the length
   of the *decoded* body, so nothing in the app changes — proved by the
   deployment check below, which watches a 25 934 402-byte tile arrive as
   16 345 818 bytes and still produce the right overlay.

   ```nginx
   location /terrain/ {
     gzip_static on;                      # serves .hgt.gz for .hgt
     add_header Cache-Control "public, max-age=31536000, immutable";
   }
   ```

   Caddy: `file_server { precompressed gzip }`. On S3/CloudFront there is no
   negotiation — upload the `.gz` file *as* the object name with
   `Content-Encoding: gzip` metadata set, or drop `--gzip` and let CloudFront
   compress (it will not: it skips bodies over 10 MB, so precompress).

2. **Caching.** The elevation of a fixed square of the planet does not change.
   `immutable` with a one-year max-age on `/terrain/` and `/peaks/` turns the
   second visit into zero bytes.

3. **No rewrite rule.** Do not fall back to `index.html` for unknown paths. A
   missing tile must 404; if `index.html` arrives where a grid was expected, the
   store reports a truncated download instead of an absent one.

`npm run serve:dist` runs `scripts/static-server.ts` — a plain file server with
exactly these rules — for local checking. It is a harness, not a production
server.

## Where terrain is missing

Nothing is drawn, and the app says why. It names the position, the SRTM tile
that position needs, every grid the deployment *is* serving, and the command
that closes the gap — and it states outright that silence is not a verdict:

> No terrain data for 45.92370, 6.86940. That position needs SRTM tile N45E006,
> which this app does not have. It is serving: N37W122, N45E007, … Run
> "npm run fetch:tiles -- N45E006" and serve data/tiles/ at /terrain/. Until
> then there is no horizon and no visibility verdict here, so nothing is drawn —
> an empty overlay would look like "no peaks are visible", which is a different
> claim.

If you are packaging for the public, edit that last sentence's advice
(`noTerrainMessage` in `src/app/overlay-builder.ts`) — telling a visitor to run
an npm command is right for a developer and useless for anyone else.

## Peaks

**The app does not fetch peaks.** `src/app/main.tsx` imports
`fixtures/peaks/ground-truth-peaks.json` (15 cited summits, 12 KB), so Vite
compiles it into the JS bundle. Packaging asserts this is still true by looking
for a summit name in the built JS, and fails loudly if it is not — the day the
app switches to HTTP peaks, that is a packaging failure rather than an empty
overlay in front of a user.

The imported Overture regions (`fixtures/peaks/regions/`, thousands of summits,
3.2 MB) are far too large to inline. They are staged at `/peaks/<region>/` in
the layout `TiledPeakStore` expects — `index.json` beside a `cells/` directory,
one 1° cell per file, named exactly like the SRTM tiles — so the switch is a
change to one file in `src/app/` and *not* also a deployment change. Until then
those files are served and unused.

## Attribution — a live compliance gap

**The running app displays no attribution of any kind.** Grepping the built
bundle for `OpenStreetMap`, `ODbL`, `Overture` or `attribution` returns nothing.
That is fine today only because the summits currently shipped are 15 facts cited
from Wikipedia; it stops being fine the moment the Overture regions are wired
in, and that work is already in the tree.

| Data | Licence | Obligation |
|---|---|---|
| SRTM 1 arc-second (terrain) | Public domain (NASA/USGS) | None. Credit is courtesy. |
| Overture Maps `base/land` summits | **ODbL-1.0**, © OpenStreetMap contributors | Attribution **required**, in the app, visible to users; licence must be named; a modified database must be offered under the same terms. |
| The 15 cited ground-truth summits | Facts, cited to Wikipedia/USGS GNIS per source | Citations kept in the dataset; no display obligation for the facts themselves. |

`npm run package:deploy` writes `dist/ATTRIBUTION.txt` from the staged data's own
citation records, so a deployer has something true to publish. **A text file
nobody links to is not attribution.** Before shipping peak regions, the app
needs a visible credit — a footer is enough:

> Elevation: NASA SRTM (public domain). Summits: © OpenStreetMap contributors,
> ODbL-1.0, via Overture Maps.

## The self-check

```bash
npm run build
npm run package:deploy -- --gzip
npm run test:deploy
```

`npm run test:deploy` is a separate Playwright project
(`scripts/deploy-check/`), and separate on purpose: the root config starts
`npm run dev`, so every spec there runs against Vite and its terrain plugin —
the exact machinery a deployment does not have. The deploy config starts nothing
but the plain static server over `dist/`, and asserts:

* `/terrain/manifest.json` is **byte-identical to the packaged file** (a dev
  server generates it per request; a deployment cannot), and every grid it
  promises answers a HEAD request;
* the served HTML is the built one — no `/@vite/client`;
* the Gornergrat fixture photo produces a live overlay naming the Matterhorn,
  with the summit marker within 12 px of the closed-form projection derived in
  `tests/e2e/app.spec.ts`;
* a 25.93 MB tile arrives gzipped and still passes the store's length check;
* **every request the page makes is same-origin** — decision D7, enforced rather
  than asserted;
* a viewpoint with no tile produces the named absence above, not a blank
  overlay;
* the staged peak cells resolve the way `TiledPeakStore` would resolve them.

## Reducing the 25 MB

One alpine tile is 25.93 MB (16.35 MB gzipped) for a sweep that reads a 30 km
disc around one point. The options, measured:

| Option | Cost per session | Trade-off |
|---|---|---|
| Whole tile, uncompressed (today's default) | 25.93 MB | Nothing to build. |
| **Whole tile, gzip (`--gzip`)** | **16.35 MB** | None: zero app code, one server setting, already proved. |
| Pre-cut 30 km window per viewpoint | 10.85 MB raw / 7.13 MB gz | Needs a packaging step that mosaics across tile edges — a 30 km box is 0.54° × 0.78°, so it straddles a 1° boundary for ~90 % of viewpoints. A window cut too small produces **false visible** peaks (`src/pipeline/testing/case-terrain.ts`), which is the expensive kind of wrong. |
| HTTP Range per grid row | 5.6 KB × 1 941 rows = 10.85 MB | Exactly the window's bytes, but **uncompressed**: a byte range addresses the stored object, so ranges and a precompressed `.gz` are mutually exclusive. 1 941 round trips, or multipart/byteranges parsing. Worse than the pre-cut window on the wire *and* in code, where an off-by-one row is invisible. |
| SRTM3 (3 arc-second) | 2.88 MB per tile (11 %) | 90 m postings against a 90 m sweep step: ridge crests get smoothed away, and a missed crest is a false *visible*. Not acceptable for the occluder that hides the summit; only defensible for terrain far beyond the 30 km sweep, which this app does not read. |
| Service worker / Cache Storage | 16.35 MB once, then 0 | Orthogonal, and additive to any row above. Turns a re-opened photo on a train into zero bytes. |

**Recommendation, in order.**

1. **Ship `--gzip` and set `gzip_static` / `precompressed`.** 37 % off the wire
   for one line of server config, no app change, proved by `npm run test:deploy`.
2. **Set `Cache-Control: immutable`.** The second visit is free; this is the
   largest real-world win after gzip and costs nothing.
3. Then, if it still matters, **pre-cut windows at packaging time** — not Range
   requests. The manifest format was built for it (a grid is any rectangle with
   its own corner and step, which is what the case windows already are) and the
   tile reader already parses one, so it needs no new runtime code, only a
   packaging step that cuts a mosaic spanning tile boundaries and a rule for the
   radius (sweep 30 km + margin). 7.13 MB gzipped for an alpine viewpoint.
4. **Do not reach for SRTM3**, and do not mix resolutions within the sweep. The
   whole point of the 25 MB is being able to prove an occlusion.
