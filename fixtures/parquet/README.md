# Committed Parquet slices

Real bytes from a real remote Parquet file, so the Overture reader is tested
offline against the format it actually meets. Same standard as
`fixtures/tiles/`: raw bytes plus a provenance sidecar, reproducible by a
generator script.

## `overture-zermatt-rowgroup/`

| | |
|---|---|
| Release | Overture Maps `2026-06-17.0` |
| Part | `theme=base/type=land/part-00011-2a3be0da-…-c000.zstd.parquet`, 424 105 813 bytes |
| Recorded | the Parquet footer (last 512 KiB) + the 18 leaf column chunks of **row group 21** belonging to `id, names, subtype, class, elevation, bbox` |
| Size | 1 362 032 bytes — **0.32 % of the part** |
| Regenerate | `npm run fixtures:peak-parquet` |
| Licence | Overture data © OpenStreetMap contributors, ODbL-1.0 |

Row group 21 spans lon 7.2808…7.7877, lat 45.6124…46.1577 and holds 20 629
rows, including the Matterhorn — chosen so the fixture's contents can be checked
against summit heights this repository already cites in
`fixtures/peaks/ground-truth-peaks.json`.

### It is not a standalone Parquet file, on purpose

`slice.bin` is the concatenation of byte ranges cut out of the middle and the
end of a 424 MB file. Re-encoding it into a valid small `.parquet` would mean
the tests parse bytes some *writer* produced, not bytes Overture published — and
the writer is not the thing under test.

Instead `src/providers/parquet-slice.ts` replays the ranges at their **original
file offsets** behind an `AsyncBuffer` that reports the original part's
`byteLength`. Every offset in the footer therefore resolves exactly as it does
against S3. A read of anything that was not recorded **throws**; it is never
zero-filled, because a buffer of zeros decodes into plausible-looking wrong data
and that is the failure mode this project is organised against. There is a test
asserting exactly that.

### What the sidecar's `expectations` block is for

The structural numbers — row-group count, row span, bbox statistics, column
bytes — were read off the **live file** when the slice was recorded. The offline
test re-derives them from the committed bytes and compares. The *content*
assertions (Matterhorn 4478 m, Breithorn 4164 m) come from a different place
entirely: `fixtures/peaks/ground-truth-peaks.json`, whose values are copied from
cited sources and predate this importer. Structure is checked against the file;
content is checked against a source.
