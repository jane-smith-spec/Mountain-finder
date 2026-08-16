# Review artifacts

Regenerable, committed so a reviewer can see the output without fetching 25 MB of terrain.

| File | Command that regenerates it |
|---|---|
| `gornergrat-annotated.png` | `npm run demo -- gornergrat` |
| `gornergrat-wide-annotated.png` | `npm run demo -- gornergrat --heading 238 --hfov 85 --out docs/artifacts/gornergrat-wide-annotated.png` |
| `kerry-park-annotated.png` | `npm run demo -- kerry-park-seattle --range-km 100 --range-step-m 90 --out docs/artifacts/kerry-park-annotated.png` |

All three are the real pipeline over real SRTM1 tiles, composited onto a
**synthetic backdrop that says so on the image itself**. There is no photograph of
these viewpoints in the repo; a fabricated one would be dishonest, a captioned
computed silhouette is not.

The Gornergrat images need `data/tiles/N45E007.hgt`
(`npm run fetch:tiles -- N45E007`); Kerry Park needs `N47W123 N47W122 N46W122`,
because a 100 km sweep from Seattle to Mount Rainier crosses three degree
squares.

## What changed: real peak density (2026-08-16)

These were regenerated after the Overture import was extended from Zermatt to
all four ground-truth regions. The demo now queries
`fixtures/peaks/regions/<region>/` — 1 786 summits for Gornergrat, 2 717 for
Kerry Park — instead of the 15 hand-cited summits in
`ground-truth-peaks.json`. `npm run demo -- <case> --peaks cited` still runs the
old, small dataset, and the acceptance suite is unchanged: it gates on the cited
figures, which carry individual citations, and never on these.

The Gornergrat frame went from **1 label to 10**, and the wide frame from 2 to
**18** — and both are still readable: labels stack on poles of increasing length
rather than piling on each other. Four of the wide frame's 18 are greyed
self-occluded summits on dashed poles (Rocca di Verra, Gobba di Rollin, Punta di
Rollin, Gagenhaupt) — decision D8 drawn rather than described. Honest caveats about what the density exposed are below.

## What to look at

### `gornergrat-annotated.png` — the standard 265° postcard framing

The Matterhorn flag sits **1.93° above the drawn ridge**. That is not a labelling
error — it is decision D7 made visible. The label is at the surveyed summit
(4478 m, from the peak database) while the silhouette is drawn from SRTM, which
reads that summit at 4230 m and displaces it ~320 m WSW. 1.93° at 9.58 km is
323 m of height; the documented deficit is 248 m and the 0.5° ray sampling
accounts for the rest (a lateral miss of tens of metres on a pyramid is real
height). **This must not be "fixed"**: the day these two agree, either the
summit heights have been sampled from the DEM or the silhouette has been drawn
from the peak database, and both are wrong.

Broad summits do not show it: in the wide framing the **Breithorn Occidentale**
sits 0.28° above its own ridge and **Testa Grigia** 0.02° — visually on it.
Sharp summits show the gap, broad ones do not, which is exactly what the SRTM
sampling characteristics predict. The three Breithorn summits, Klein
Matterhorn, Theodulhorn, Furgghorn and Furggen all land within 0.9°.

Two other readings the density made visible:

* **Four labels stack over one mountain.** Matterhorn, Épaule de Furggen, Picco
  Muzio and Pic Tyndall are four named OSM summit nodes within 445 m of each
  other on the Matterhorn's south ridge. The stack is correct — each is a real
  named point — but it is the clearest picture of the "one mountain, many nodes"
  problem recorded in `fixtures/peaks/README.md`.
* **A dot can sit BELOW the ridge line.** The Riffelhorn (2927 m, 1.9 km) prints
  at −8.16° against a skyline of +3.27° at the same bearing. Nothing is wrong:
  the observer is 160 m above it and the drawn horizon there is the far higher
  Matterhorn ridge behind it. The horizon polyline is the *highest* ground on
  each bearing, not the ground the label belongs to.

### `kerry-park-annotated.png` — the non-alpine case

Every previous artifact was Swiss. This one is Seattle: a nearly flat urban
skyline with **Mount Rainier at 97.7 km** on the case's stated 152° bearing,
computed across three real SRTM tiles out to 100 km.

* Rainier's dot sits **+0.02° above the drawn ridge** — a broad volcanic cone
  100 km away is exactly the case where SRTM and the peak database agree, the
  opposite end of the scale from the Matterhorn.
* Rainier's clearance over the intervening terrain is **+0.02°** — the summit
  clears the Cascade foothills by two hundredths of a degree. That is a
  genuinely marginal sightline, and it is marginal in reality too: from Kerry
  Park only Rainier's upper cone stands above the closer ridges.
* **Eight labels for one mountain**: Columbia Crest, Liberty Cap, Point Success,
  Tahoma Cleaver, Little Tahoma, Steamboat Prow, Observation Rock and Mount
  Rainier itself. `Columbia Crest` and `Mount Rainier` are two OSM nodes 230 m
  apart at the same 4 392 m — see the conflict table in
  `fixtures/peaks/README.md`.
* The strip note **"+60 more named summits in this frame — marked, too crowded
  to label"** with small dots on the ridge is the renderer refusing to draw a
  pile. 60 of 70 in-frame summits are dotted, not named.
* **Mount Baker gets no verdict in this run and is correctly not drawn.** At
  160 km it stands beyond the 100 km sweep, so the pipeline refuses to judge it
  rather than calling it visible on unmeasured ground. The acceptance case makes
  the stronger D8 claim — Baker is *foreground-occluded* by Queen Anne Hill —
  from the committed 3 km window; this image does not show that, and does not
  claim to.

## What is and is not evidence

The horizon line lying on the silhouette is **tautological** — both come from the
same profile. The peak markers are not: they come from the peak database and the
camera projection, with no reference to the terrain sweep.

## A note on Mount Diablo

`npm run demo -- mount-diablo-summit --range-km 65` is worth running and is
deliberately **not** committed as an image: it needs the four Bay Area tiles
(`N37W122 N37W123 N38W122 N38W123`) and its whole skyline sits between −0.1° and
−1.3°, which reads as a flat line with 16 labels hanging off it. It is the case
that stresses curvature, not the one that photographs well.

Do not regenerate these on every run. Update them when the output meaningfully
changes, so the diff stays reviewable.

These three were written on 2026-08-16 against `src/render` as it stood that
afternoon, while label placement was still being hardened for density. The
counts quoted above (10 / 18 / 10 markers) are what those runs printed; if a
later renderer change moves them, regenerate and update the numbers rather than
leaving a caption that no longer matches its picture.
