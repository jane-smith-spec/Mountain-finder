# `src/render` — overlay builder and PNG compositor

Phase 4 of [PLAN.md](../../PLAN.md).

## P4.1 — pure overlay builder

`buildOverlaySvg(scene, options?, theme?) → string`

A scene (image pixel size, `CameraPose`, `HorizonProfile`, `VisiblePeak[]`) in;
an SVG document out. No DOM, no filesystem, no network, no `Date.now`, no
`Math.random` — the same scene always produces the same bytes.

| Module | Role |
|---|---|
| `types.ts` | Scene, options and layout shapes. Data only. |
| `xml.ts` | Escaping and coordinate formatting. |
| `text-metrics.ts` | DOM-free text width estimation. |
| `geometry.ts` | Behind-the-camera test, Liang–Barsky frame clipping. |
| `layout.ts` | Scene → pixel geometry, including label collision avoidance. |
| `svg.ts` | Pixel geometry → SVG string. |

The layout/serialisation split is what makes the geometry assertable as
numbers instead of as substrings.

### What the overlay contains

- the terrain skyline as one or more polylines, sampled in bearing across 1.5×
  the horizontal field of view and clipped to the frame — several polylines
  when the line leaves and re-enters, never a false chord across the gap;
- per visible peak: a dot on the projected summit, a vertical flag pole, and a
  two-line label (name, then `elevation · distance`);
- peaks that project outside the frame or behind the camera are not drawn, and
  are returned in `offFramePeaks` rather than silently dropped.

### Label collision avoidance

Peaks cluster on a real skyline, so overlapping labels are the default outcome.
The rule, in full, is documented at the top of [`layout.ts`](layout.ts). In
brief: markers are placed left to right (ties broken by peak id, never by input
order), each takes the first free placement from a fixed candidate list — pole
lengths increasing one `stackStepPx` at a time, upward first and then downward —
and if nothing is free it is placed anyway and flagged `overlapped`. A level can
be *skipped*, because poles are measured from their own summits and summits
differ in height; the search tests the real boxes rather than trusting the
arithmetic. What is guaranteed is disjoint boxes, never a particular level.

### Legibility

Every mark is drawn twice: a dark translucent halo, then the bright mark.
Labels get the same via `paint-order="stroke"`, so the outline sits behind the
glyphs instead of eating into them. This is what keeps the overlay readable
over blown-out haze, sunlit snow and near-black rock in the same frame.

## P4.2 — PNG compositor

`composite.ts` — photo + overlay SVG → a single PNG, in the browser. It is not
re-exported from `index.ts`, so the purity of P4.1 is visible in the import
graph.

No `node-canvas`, and no new dependency of any kind: Chromium is already
installed and already driven by Playwright, so the raster the tests check comes
from exactly the engine that will produce the user's export. The overlay is
handed to the browser as a `data:` URL image and drawn with `drawImage` —
one SVG, one rendering engine, no second implementation of the overlay to drift
out of step.

`harness.html` is the test page the Playwright suite drives. It is not part of
the app and nothing links to it. `testing/synthetic-photo.ts` draws the
deliberately hostile background (bright haze at the skyline, near-black rock,
bright sky) that the exported artifact is reviewed against.

## Self-checks

```
npx vitest run src/render                  # P4.1 — 97 unit tests
npx playwright test tests/e2e/render.spec.ts   # P4.2 — export + raster probes
```

The e2e run writes `out/render-composite.png` and `out/render-overlay.svg` for
human review.

Test expectations here are derived from the projection model, not from the
renderer's own output: the closed forms and the arithmetic are written out at
the top of `layout.test.ts`. The single snapshot test is an overall-shape guard
only.
