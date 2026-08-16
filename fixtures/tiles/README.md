# Elevation tile fixtures

Everything here is committed and read by the tests offline. Nothing in the test
suite depends on `data/tiles/`, which is gitignored and empty on a fresh clone.

Regenerate the whole directory with:

```
npm run fixtures:tiles          # scripts/make-tile-fixtures.ts
```

The real-data windows need their source tile present, so if the directory is
being rebuilt from scratch, first:

```
npm run fetch:tiles -- N45E007 N46E007
```

## Real SRTM data

| File | What it is |
|---|---|
| `matterhorn-window.i16be` + `.json` | 256 × 256 samples cut byte-for-byte out of **N45E007** at source row 64, col 2240. Contains the Matterhorn massif; highest posting 4230 m. |
| `zermatt-window.i16be` + `.json` | 64 × 64 samples cut out of **N46E007** at source row 3494, col 2665. Zermatt village, valley floor 1608 m. |

Same byte format as a `.hgt` file — signed 16-bit **big-endian**, row-major,
row 0 = north — but a rectangle rather than a whole degree, so the geometry is
written down in the JSON sidecar instead of being derived from the file length.
Each sidecar records the source tile, the exact download URL, the row/column
offsets of the cut, the resulting bounds, and the statistics of the data.

Two things these windows document by existing:

* **Zermatt is in N46E007, not N45E007.** The village sits at 46.0207 N, north of
  the 46° line, so the floor-based tile naming sends it to the tile above the
  Matterhorn's. Cutting a window "around Zermatt" out of N45E007 would sample
  somewhere else entirely.
* **This data source has no voids.** The AWS `elevation-tiles-prod/skadi` mirror
  is void-filled: the Zermatt valley floor reads 1608 m, not the −32768 void
  marker. Scanned across N45E007, N46E007, N27E086 and N28E086 — 0 voids in
  51 868 804 samples. Voids are still a real part of the `.hgt` format and other
  distributions carry them, so the reader handles them; that path is covered by
  the synthetic tiles below rather than by fabricating voids into real data.

## Synthetic tiles

Whole small `.hgt` tiles whose terrain is a closed-form function, so every sample
and every interpolated value has an expectation derivable from the formula. See
`synthetic-manifest.json` for the formula of each.

| File | Terrain | What it covers |
|---|---|---|
| `N00E000.hgt` | `h = 500 + 300·lat + 200·lon + 400·lat·lon`, 21² | Bilinear surface — interpolation is exact on it, so weights and axis order are checkable |
| `N01E000.hgt` | the same surface, 21² | The northern neighbour: the two share the lat = 1 line sample for sample |
| `S01W001.hgt` | `h = 1234`, 11² | Southern **and** western hemisphere naming, end to end through the directory store |
| `S02W002.hgt.gz` | `h = 777`, 11² | The gzip path |
| `N10W010.hgt` | cone with a 3 × 3 void block, 41² | Voids read from a file; nearest/bilinear void policy |

Grid sizes here are deliberately *not* real SRTM sizes: the reader must derive
`n` from the file length (`n² × 2` bytes) rather than assume 1201 or 3601.
