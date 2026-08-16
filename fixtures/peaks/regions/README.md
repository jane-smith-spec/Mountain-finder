# Imported peak regions

Peak datasets imported from Overture Maps by `npm run fetch:peaks`, cut into
1°×1° cells and queried by `TiledPeakStore`
(`src/providers/peak-tile-store.ts`).

This is Q5's answer to the coverage problem: `../ground-truth-peaks.json` holds
15 hand-cited summits assembled for four viewpoints, which is why v2.0 only
works at those four. A region here holds every named summit Overture carries in
its area.

## Layout

```
<region>/index.json         manifest: citations, bounds, release, cell list
<region>/cells/N45E007.json { "cell": "N45E007", "peaks": [ … ] }
```

Cells are named with the **same 1° naming as the SRTM terrain tiles**
(`tileNameFor`), so a query resolves to the same cell names on the peak side and
the elevation side, and there is no second cell-naming rule to disagree with the
first at 0° or 180°.

A query loads only the cells its radius touches, and caches them. `index.json`
is enough to answer "how many peaks are in this dataset" and "which cells exist"
without opening one.

## `zermatt/`

| | |
|---|---|
| Source | Overture Maps release `2026-06-17.0`, `theme=base/type=land` |
| Area | 45.6…46.4 N, 7.2…8.2 E — Upper Valais |
| Summits | 1 786 across 4 cells (`N45E007`, `N45E008`, `N46E007`, `N46E008`), 61 of them above 4 000 m |
| Cost | 42.17 MB fetched of a 29.47 GB release = **0.1431 %** |
| Regenerate | `npm run fetch:peaks -- --region zermatt` |
| Licence | © OpenStreetMap contributors, ODbL-1.0, via Overture |

It covers the Gornergrat acceptance viewpoint and the two SRTM tiles the
repository already holds terrain for.

## Where the numbers come from

* **Position** is the midpoint of Overture's `bbox`, which is the point geometry
  rounded outward to float32 — sub-metre for a summit. See
  `src/providers/overture-peaks.ts` for why `geometry` (96 % of the bytes) is not
  read for a 0.3 m gain.
* **Height** is Overture's `elevation` column, which carries the OpenStreetMap
  `ele` tag through unchanged — verified row by row against the same rows'
  `source_tags.ele` on the live data (Matterhorn `"4478"` → 4478, Weisshorn
  `"4505"` → 4505). Records therefore declare `elevationSourceKind: "osm"`,
  which is the honest label in the frozen contract.
* **A summit with no `ele` tag is dropped, not filled in.** MISSION.md forbids
  taking peak heights from the DEM: SRTM under-reads sharp summits by 250–350 m
  and displaces them ~320 m. The import counts and prints those drops (285 of
  them in the Zermatt area).

## These do NOT replace the cited dataset

`../ground-truth-peaks.json` remains the authority for the acceptance suite. Its
values carry individual citations; these carry one dataset-level citation to an
OSM-derived aggregate. **Where the two disagree, the cited value wins** — see
the disagreement table in `../README.md`.
