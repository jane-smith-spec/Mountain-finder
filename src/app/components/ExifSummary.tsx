/**
 * "What this photo claims" — the raw EXIF, before any merging.
 *
 * Shown separately from the override panel on purpose. The panel says what the
 * app is going to *use*; this says what the file actually *records*, including
 * readings the app refuses to use — a magnetic bearing, or a direction with no
 * true/magnetic reference. Seeing the raw number is what lets a user decide to
 * type it in themselves, under their own name, rather than have the app quietly
 * promote it.
 */

import type { PhotoExif } from '../../exif';
import type { DimensionInfo } from '../state';

export interface ExifSummaryProps {
  exif: PhotoExif;
  dimensions: DimensionInfo;
}

interface Claim {
  readonly label: string;
  readonly value: string;
  /** Set when the app cannot use this reading as-is. */
  readonly caveat?: string;
}

function buildClaims(exif: PhotoExif): readonly Claim[] {
  const claims: Claim[] = [];
  if (exif.lat !== undefined && exif.lon !== undefined) {
    claims.push({
      label: 'GPS position',
      value: `${exif.lat.toFixed(6)}°, ${exif.lon.toFixed(6)}°`,
    });
  }
  if (exif.gpsAltitudeM !== undefined) {
    claims.push({
      label: 'GPS altitude',
      value: `${exif.gpsAltitudeM.toFixed(1)} m above sea level`,
      caveat: 'This is the camera’s altitude, not the ground’s; phone GPS altitude is often wrong.',
    });
  }
  if (exif.imgDirectionDeg !== undefined) {
    const ref = exif.imgDirectionRef;
    const refLabel = ref === 'T' ? 'true north' : ref === 'M' ? 'MAGNETIC north' : 'no reference';
    const claim: Claim = { label: 'Image direction', value: `${String(exif.imgDirectionDeg)}° (${refLabel})` };
    claims.push(
      ref === 'T'
        ? claim
        : {
            ...claim,
            caveat:
              ref === 'M'
                ? 'Unusable as a true-north heading until a magnetic declination is supplied.'
                : 'Unusable: the photo does not say whether this is true or magnetic.',
          },
    );
  }
  if (exif.focalLengthMm !== undefined) {
    claims.push({ label: 'Focal length', value: `${String(exif.focalLengthMm)} mm` });
  }
  if (exif.focalLength35mmMm !== undefined) {
    claims.push({
      label: '35 mm equivalent',
      value: `${String(exif.focalLength35mmMm)} mm`,
    });
  } else if (exif.focalLengthMm !== undefined) {
    claims.push({
      label: '35 mm equivalent',
      value: 'not recorded',
      caveat: 'Without it the physical focal length alone gives no field of view.',
    });
  }
  if (exif.imageWidthPx !== undefined && exif.imageHeightPx !== undefined) {
    claims.push({
      label: 'EXIF dimensions',
      value: `${String(exif.imageWidthPx)} × ${String(exif.imageHeightPx)} px`,
    });
  }
  return claims;
}

export function ExifSummary({ exif, dimensions }: ExifSummaryProps): JSX.Element {
  const claims = buildClaims(exif);
  return (
    <section className="panel" aria-labelledby="exif-heading" data-testid="exif-summary">
      <h2 id="exif-heading">2. What this photo claims</h2>
      {claims.length === 0 ? (
        <p className="status status--warn" data-testid="exif-empty">
          No EXIF at all. Every pose field below needs manual input — nothing has been guessed.
        </p>
      ) : (
        <dl className="claims">
          {claims.map((claim) => (
            <div className="claims__row" key={claim.label}>
              <dt>{claim.label}</dt>
              <dd>
                {claim.value}
                {claim.caveat !== undefined && <span className="claims__caveat">{claim.caveat}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="status" data-testid="decoded-dimensions">
        Decoded image: <strong>{dimensions.widthPx}</strong> × <strong>{dimensions.heightPx}</strong>{' '}
        px (measured from the pixels, which is what the overlay is drawn onto).
        {dimensions.exifDisagrees && (
          <span className="claims__caveat">
            The EXIF dimension tags disagree with the decoded image; the decoded size wins.
          </span>
        )}
      </p>
    </section>
  );
}
