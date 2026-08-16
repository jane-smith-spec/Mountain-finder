# src/pipeline — the orchestration layer

One entry point per input shape, both returning an `AnnotatedScene`:

```ts
annotateScene({ observer, camera, elevation, peaks, config })   // stated viewpoint
annotatePhoto({ exif, overrides, elevation, peaks, config })    // a photograph
```

```
resolve observer ─▶ sweep terrain ─▶ build horizon ─▶ fetch peaks
                                            │              │
                                            └──▶ sight ──▶ filter (nearer terrain only) ──▶ project
```

## What belongs here and what does not

| layer | rule |
|---|---|
| `src/core` | pure functions, no I/O, no clock. Never import a provider. |
| `src/providers` | the outside world behind interfaces. |
| **`src/pipeline`** | **awaits providers, calls core, returns data.** |
| `src/render` | turns that data into an overlay. |

Everything the pipeline depends on is an argument — the elevation source, the
peak source, the tolerances and the clock — so a test run is the production run
with fixtures in place of tiles. There is no module-level state and no default
provider.

The result is **data, never pixels**. It carries the whole `HorizonProfile`
(with each point's skyline staircase) precisely so the renderer draws the same
skyline the visibility filter judged against.

## The two rules this layer exists to keep

1. **Summit heights come from the peak database; terrain comes from SRTM.**
   The tiles under-read sharp summits by 250–350 m *and displace them*, so a
   summit height sampled from the DEM would put a label hundreds of metres low
   and sideways. Ground elevation *under the observer* is the opposite case —
   broad terrain, where SRTM is accurate to the metre — so that one IS read from
   the tiles when nobody supplies it (`observer.ts`).

2. **A peak is occluded only by terrain NEARER than the peak.** `src/core`
   implements the rule; the pipeline's job is to feed it a profile that carries
   the per-bearing staircase, which `buildHorizonProfile` does for every ray.
   `occlusion.ts` then names the piece of ground responsible, which is what
   turns "not labelled" into "hidden by a 250 m shoulder at 1.2 km".

3. **An occluded peak is only labelled when its OWN hill is what hides it**
   (decision D8). `classifyOcclusion` in `src/core/visibility.ts` walks the
   peak's own ray from the first crest that gets in the way out to the summit:
   if the ground never drops below that crest there is no col, so the two are
   one landform and `AnnotatedScene.selfOccluded` carries the peak for the
   renderer to draw greyed. If a col intervenes — or the terrain between was
   never sampled — it lands in `foregroundOccluded` and is never drawn, because
   the label would sit on a different hill's face. `labelled` is the union the
   renderer should consume.

## Refusals

The pipeline throws rather than inventing a plausible number:

| code | when |
|---|---|
| `observer-elevation-unknown` | no supplied height, no terrain, no fallback. Assuming sea level would produce a wrong horizon and labels that all look reasonable. |
| `no-terrain` | the sweep found no usable elevation anywhere. Not a scene with an empty horizon — a run with no evidence. |
| `internal-inconsistency` | the annotated verdicts disagree with `filterVisiblePeaks` over the same inputs. |
| `aborted` | the caller's `AbortSignal` fired. |

Terrain samples with no data are **dropped**, never coerced to 0 m, and counted
in `SweepReport.gaps` so a run over unfetched tiles is loud rather than
plausible.

## `testing/` — node-only helpers

* `elevation-sources.ts` — an analytic terrain source, a nearest-sample cloud
  source (used to feed the analytic scenes their own generated samples), and a
  static peak source. Pure; usable in a browser.
* `case-terrain.ts` — the committed SRTM windows for the ground-truth cases,
  their sweep settings, and **what each window can and cannot prove**. Reads the
  filesystem, so it is imported separately, exactly like `tile-directory.ts`.
