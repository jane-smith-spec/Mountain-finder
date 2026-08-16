# Peak dataset fixtures

`ground-truth-peaks.json` is the **offline peak database** the pipeline queries
(decision D7: the product works with no network). `index.ts` parses it through
`parsePeakDataset` and exports a ready `LocalPeakStore`.

## Where the numbers come from

Every coordinate and every height is **copied** from the ground-truth case files
in `tests/acceptance/cases/`, which already carry the citation, the retrieval
date and an honest note about how the page was read (most were read through the
web-search index, because this sandbox's egress proxy 403s Wikipedia). The
`sources[]` array reproduces those citations, and every peak's
`positionSourceId` / `elevationSourceId` must resolve to one of them — the
parser refuses a dataset where it does not.

Nothing here was invented, rounded to taste, or sampled from a DEM.

## Summit heights never come from SRTM

This is the rule the whole file exists to keep:

| quantity | source |
|---|---|
| terrain horizon (the occluding ridge line) | SRTM tiles — accurate for broad relief |
| **summit height** | **this dataset** — surveyed / published figures |

SRTM under-reads sharp summits by 250–350 m *and displaces them*: N45E007 puts
the Matterhorn at 4230 m against a surveyed 4478 m, and its highest posting sits
~320 m WSW of the true summit (which itself reads 3567 m). A pipeline that
sampled summit heights from the tiles would label every alpine peak hundreds of
metres low and sideways.

## `elevationSourceKind`

`Peak.elevationSource` in the frozen core contract is `'osm' | 'srtm' |
'unknown'`. Published survey and gazetteer figures are none of those, so records
here declare `'unknown'` — "core has no name for this provenance" — rather than
claim to be OSM tags or DEM reads. The real citation is in `elevationSourceId`.
Records imported from OSM will set `'osm'` and keep the tag provenance.

## The importer path

The Overpass client (`src/providers/peaks.ts`) is **not** retired. It is the
importer that will regenerate this file once egress to `overpass-api.de` is
allowed (`npm run record:fixtures`, then a conversion pass). At that point peak
ids become real OSM object ids (`node/12345`) instead of the `mf/` prefix used
here, and the file is replaced wholesale rather than merged — a half-imported
dataset with two id schemes is exactly the kind of quiet inconsistency this
project keeps designing against.

## Deliberate omissions

* **Liskamm** (4,527 m) belongs in the Gornergrat panorama and is certainly
  visible from there, but no coordinate for it could be sourced in this
  environment. `tests/acceptance/cases/gornergrat.ts` records that as a caveat;
  guessing one here would be worse than leaving it out.
* No peak appears that is not needed by a case. This is a fixture, not a
  gazetteer.

## Overture cross-check (Q5, 2026-08-16) — and where it disagrees

Every summit in this file was looked up in Overture Maps release `2026-06-17.0`
(`theme=base/type=land`) by the importer described in `regions/README.md`, using
four bounding boxes (Valais, California, Cascades, Lochaber). The Overture value
is OpenStreetMap's, carried through unchanged; the value in this file is the one
with an individual citation.

**Where they disagree, the cited value wins and this file is unchanged.** The
disagreements are recorded rather than resolved, because resolving them needs
sources this environment cannot reach.

| cited summit | cited | Overture | Δ height | Δ position |
|---|---|---|---|---|
| Matterhorn | 4478 m | 4478 m | 0 | 4.5 m |
| Dufourspitze | 4634 m | 4634 m | 0 | 25.1 m |
| Breithorn | 4164 m | 4164 m | 0 | 36.0 m |
| Mount Diablo | 1173 m | 1173 m | 0 | 0.1 m |
| **Mount Hamilton** | **1300 m** | **1279 m** | **−21 m** | 23.1 m |
| **Mount Saint Helena** | **1323 m** | **1319 m** | **−4 m** | 26.9 m |
| **Mount Tamalpais East Peak** | 784 m | 784 m | 0 | **1754 m** |
| Lassen Peak | 3187 m | 3187 m | 0 | 14.4 m |
| Half Dome | 2696 m | 2694 m | −2 m | 21.5 m |
| Sentinel Dome | 2476 m | 2475 m | −1 m | 199.6 m |
| Mount Rainier | 4392 m | 4392 m | 0 | 229.9 m |
| Mount Baker | 3286 m | 3287 m | +1 m | 13.9 m |
| Mount Hood | 3429 m | 3429 m | 0 | 11.3 m |
| Ben Nevis | 1345 m | 1345 m | 0 | 1.3 m |
| Cow Hill | 287 m | 287 m | 0 | 114.0 m |

Thirteen of fifteen heights agree exactly or within 2 m. What the exceptions mean:

* **Mount Hamilton, −21 m.** The largest height disagreement in the set.
  1300 m is 4265 ft; OSM's `ele=1279` is a different datum or a different
  source. 21 m at Mount Hamilton's 66 km range from Mount Diablo is 0.018° of
  altitude angle — nowhere near the margins the acceptance suite gates on, but
  it is a real conflict and neither value can be checked from here.
* **Mount Tamalpais East Peak, 1754 m apart.** A *positional* conflict, and the
  only serious one. The two coordinates are 1.75 km apart on a mountain whose
  three summits span about a kilometre, so at least one of them is not the East
  Peak. Overture's record is a live OSM node; the cited coordinate came through
  the web-search index. **This should be re-checked before Mount Tamalpais backs
  any assertion.** It currently only appears in the Mount Diablo case as a
  must-see at 60 km, where 1.75 km of lateral error is 1.7° of bearing — enough
  to move a label visibly, not enough to change the visibility verdict.
* **Mount Rainier, 230 m; Sentinel Dome, 200 m; Cow Hill, 114 m.** Summit-plateau
  disagreements: Rainier's OSM node sits inside the summit ice cap, Cow Hill and
  Sentinel Dome are broad tops. `own-estimate-sentinel-dome` was already flagged
  in this file as the weakest coordinate in the set, and Overture agrees with it
  to 200 m, which is neither confirmation nor refutation.
* **"Breithorn" is a naming conflict, not a data one.** OSM names the 4164 m
  west summit `Breithorn Occidentale / Westgipfel`; this file calls it
  `Breithorn`. Same height, 36 m apart. Worse, the imported Valais region
  contains three *other* peaks literally named `Breithorn` (3438 m, 3178 m,
  2599 m) — so once real coverage is switched on, a peak database lookup by name
  is ambiguous and only the id is safe. `LocalPeakStore.byName` already returns
  an array; nothing may assume it holds one element.
