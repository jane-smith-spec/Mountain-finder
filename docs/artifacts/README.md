# Review artifacts

Regenerable, committed so a reviewer can see the output without fetching 25 MB of terrain.

| File | Command that regenerates it |
|---|---|
| `gornergrat-annotated.png` | `npm run demo -- gornergrat` |
| `gornergrat-wide-annotated.png` | `npm run demo -- gornergrat --heading 238 --hfov 85` |

Both are the real pipeline over the real SRTM1 tile `N45E007`, composited onto a
**synthetic backdrop that says so on the image itself**. There is no photograph of
these viewpoints in the repo; a fabricated one would be dishonest, a captioned
computed silhouette is not.

## What to look at

The Matterhorn flag sits **1.92° above the drawn ridge**. That is not a labelling
error — it is decision D7 made visible. The label is at the surveyed summit
(4478 m, from the peak database) while the silhouette is drawn from SRTM, which
reads that summit at 4230 m and displaces it ~320 m WSW. 1.92° at 9.58 km is
321 m of height; the documented deficit is 248 m and the 0.5° ray sampling
accounts for the rest (84 m of lateral miss on a pyramid is real height).

Broad summits do not show it: in the wide framing the **Breithorn** sits 0.27°
above its own ridge — visually on it. Sharp summits show the gap, broad ones do
not, which is exactly what the SRTM sampling characteristics predict.

The horizon line lying on the silhouette is **tautological** — both come from the
same profile. The peak markers are not: they come from the peak database and the
camera projection, with no reference to the terrain sweep.

Do not regenerate these on every run. Update them when the output meaningfully
changes, so the diff stays reviewable.
