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
