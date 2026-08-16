Photo metadata extraction and the manual-override merge model.

This is the ingestion boundary. EXIF goes in; an `Observer` and a `CameraPose`
(src/core/types.ts) come out — or an explicit list of what is still missing.

## The two steps

```ts
import { extractPhotoExif, resolvePose, STANDARD_DEFAULTS } from './exif';

const exif = await extractPhotoExif(file);            // P3.1 — what the file claims
const pose = resolvePose(exif, userOverrides, {       // P3.2 — merged with user input
  magneticDeclinationDeg: 1.8,
  defaults: STANDARD_DEFAULTS,
});

if (pose.complete) {
  render(pose.observer, pose.cameraPose);
} else {
  promptFor(pose.missing);      // e.g. ['groundElevationM', 'headingDeg']
}
```

`extractPhotoExif` reads GPS latitude/longitude, GPS altitude, GPSImgDirection
with its GPSImgDirectionRef, focal length and 35 mm equivalent, and the image
pixel dimensions. It derives `hFovDeg = 2*atan(36 / (2*f35))` and, from the
aspect ratio, `tan(vFov/2) = tan(hFov/2) * height/width`. Missing tags come back
as absent properties — never as zeros.

`resolvePose` merges three layers, highest precedence first: **user overrides**,
then **EXIF**, then **caller-supplied defaults**. Each of the nine pose fields
ends up either `resolved` (with its source recorded) or `needs-manual` (with a
reason a UI can act on).

## Rules this module exists to enforce

- **Magnetic is never treated as true.** `GPSImgDirectionRef: 'M'` yields a
  heading only when the caller supplies `magneticDeclinationDeg`
  (`trueBearing = magneticBearing + declination`); otherwise the heading is
  flagged `magnetic-declination-required`. There is no geomagnetic model here on
  purpose — supplying the declination is the caller's job. A direction with *no*
  reference tag is flagged `direction-reference-unknown` unless the caller
  explicitly opts into an assumption.
- **Nothing is silently defaulted.** `STANDARD_DEFAULTS` (1.6 m eye height,
  level, unrolled) is offered, not applied; pass it in and the affected fields
  report `source: 'default'`. A photo with no EXIF flags all nine fields.
- **GPS altitude is a hint.** It is the *camera's* altitude, so
  `groundElevationM = gpsAltitudeM - eyeHeightM`, and `GPSAltitudeRef: 1` means
  below sea level (exifr does not apply that sign — this module does). The value
  is often tens of metres wrong: a caller holding an elevation provider should
  override `groundElevationM` with a real terrain lookup. The raw reading stays
  visible as `PoseResolution.gpsAltitudeM`.
- **Southern and western hemispheres come out negative.** Proven by fixtures,
  not assumed.

## Fixtures

`fixtures/photos/` holds four generated JPEGs, one per awkward case (complete
N/E photo, S/W photo with a magnetic heading and no 35 mm equivalent, a
below-sea-level portrait with an unreferenced direction, and a fully stripped
photo). They are authored in `testing/fixtures.ts` and written by:

```
npx tsx src/exif/testing/generate.ts
```

`exifr` reads EXIF but cannot write it and this environment has no `exiftool`,
so `testing/jpeg.ts` writes the TIFF/EXIF structure and a baseline JPEG from
first principles — no authoring dependency. `testing/fixtures.test.ts` re-encodes
the committed files and asserts byte equality, so editing a fixture definition
without regenerating fails the suite. It also decodes each file with `jpeg-js`
(an unrelated third-party decoder) to prove the fixtures are real images.

Test expectations are computed by hand from the authored degrees/minutes/seconds
and the FOV closed forms, never by running the extractor.
