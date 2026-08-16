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
### Re-checked against the committed regions (2026-08-16, second pass)

The first pass compared against a live import held in memory. All four regions
are now committed under `regions/` (california, cascades, fort-william,
zermatt), so the same comparison was re-run **against the bytes in this
repository** and every row above reproduces exactly. Asking a second question of
the same data — *which Overture summit is NEAREST to each cited coordinate,
whatever it is called* — sharpens three of the conflicts and adds none:

| cited summit | cited coord | nearest Overture node | distance | reading |
|---|---|---|---|---|
| **Mount Tamalpais East Peak** | 37.923922, −122.596644 | **`Mount Tamalpais West Peak`, 778 m** | **20.4 m** | the cited coordinate is OSM's **West** Peak, not the East Peak |
| **Mount Hamilton** | 37.341722, −121.642833 | `Mount Hamilton`, 1279 m | 23.1 m | but `Observatory Peak`, **1298 m**, is 37 m away |
| **Mount Rainier** | 46.852886, −121.760374 | **`Columbia Crest`, 4392 m** | **3.3 m** | the node named `Mount Rainier` is the one 230 m away |

* **Mount Tamalpais is now a much sharper conflict, and still not resolved
  here.** The cited record pairs the *East* Peak's name and its height (784 m,
  which is exactly OSM's East Peak `ele`) with a coordinate that sits 20 m from
  OSM's *West* Peak (778 m) and 1 754 m from OSM's East Peak. Two independent
  readings of the same mountain do not disagree by 1.75 km by accident; the most
  likely explanation is that the cited coordinate was read off the wrong summit
  of a three-summit ridge. **The cited value still wins by default** — it has a
  source and this environment cannot reach a better one — but nothing should
  assert on Mount Tamalpais's *position* until someone checks it against a
  gazetteer. Its height is not in doubt.
* **Mount Hamilton's −21 m is probably a summit-vs-observatory split, not a
  datum error.** OSM carries two nodes 40 m apart: `Mount Hamilton` 1 279 m and
  `Observatory Peak` 1 298 m. The cited 1 300 m (4 265 ft) is within 2 m of the
  *latter*. So the disagreement is most likely about which point on the summit
  ridge the name attaches to. Reported, not reconciled: picking one would be
  choosing a source, which is exactly what this table exists to avoid.
* **Mount Rainier's 230 m is a two-node naming split.** The cited coordinate
  lands 3.3 m from OSM's `Columbia Crest` — the true summit — while the node
  named `Mount Rainier` sits 230 m away at the same 4 392 m. Nothing here is
  wrong; a name lookup just picks the further of two nodes for the same
  mountain, and a renderer draws both.

**One mountain, many nodes — the density finding.** The same query shows how
often a single mountain arrives as a cluster of summit nodes: Matterhorn 4
(Épaule de Furggen, Picco Muzio, Pic Tyndall within 445 m), Mount Hamilton 5,
Dufourspitze 3, Mount Diablo 3, Mount Rainier 2, Half Dome 2. This is not an
import bug — every one is a genuinely named point in OSM — but it is why the
regenerated demo images stack four labels on the Matterhorn and eight around
Rainier, and it belongs in whatever eventually decides which summits are worth
naming in a frame.

**Name lookups are worse than the Breithorn case suggested.** `Cow Hill` is
287 m in Lochaber and 989 m in Santa Clara County, California — two of the
regions committed here. Within one region, California alone holds 306 repeated
names (36 × `Bald Mountain`, 36 × `Sugarloaf`, 25 × `Red Mountain`); the
Cascades hold 164 and Lochaber 48. `LocalPeakStore.byName` returning an array is
not a formality.

* **"Breithorn" is a naming conflict, not a data one.** OSM names the 4164 m
  west summit `Breithorn Occidentale / Westgipfel`; this file calls it
  `Breithorn`. Same height, 36 m apart. Worse, the imported Valais region
  contains three *other* peaks literally named `Breithorn` (3438 m, 3178 m,
  2599 m) — so once real coverage is switched on, a peak database lookup by name
  is ambiguous and only the id is safe. `LocalPeakStore.byName` already returns
  an array; nothing may assume it holds one element.
