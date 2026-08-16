/**
 * The pose the overlay will actually consume — resolved fields plus trim.
 *
 * This is the seam made visible. Everything the pipeline receives
 * (`OverlayRequest`) is on screen here, and each number is also exposed as a
 * `data-*` attribute at full precision so an e2e test can assert the exact
 * value rather than a rounded rendering of it. When the renderer is wired in,
 * this readout stays: it is how a user (or a reviewer) checks that what they
 * see drawn matches what they asked for.
 */

import type { PoseField } from '../../exif';
import { POSE_FIELD_META } from '../pose-fields';
import type { OverlayRequest } from '../seam';

export interface PoseReadoutProps {
  request?: OverlayRequest;
  missing: readonly PoseField[];
}

export function PoseReadout({ request, missing }: PoseReadoutProps): JSX.Element {
  if (request === undefined) {
    return (
      <section className="panel" aria-labelledby="pose-heading">
        <h2 id="pose-heading">6. Overlay input</h2>
        <p className="status status--warn" data-testid="overlay-pose-incomplete">
          No pose yet. Still needed: {missing.map((field) => POSE_FIELD_META[field].label).join(', ')}
          .
        </p>
      </section>
    );
  }

  const { observer, pose, frame } = request;
  return (
    <section className="panel" aria-labelledby="pose-heading">
      <h2 id="pose-heading">6. Overlay input</h2>
      <dl
        className="claims"
        data-testid="overlay-pose"
        data-lat={String(observer.lat)}
        data-lon={String(observer.lon)}
        data-ground-elevation-m={String(observer.groundElevationM)}
        data-eye-height-m={String(observer.eyeHeightM)}
        data-heading-deg={String(pose.headingDeg)}
        data-pitch-deg={String(pose.pitchDeg)}
        data-roll-deg={String(pose.rollDeg)}
        data-hfov-deg={String(pose.hFovDeg)}
        data-vfov-deg={String(pose.vFovDeg)}
        data-width-px={String(frame.widthPx)}
        data-height-px={String(frame.heightPx)}
      >
        <div className="claims__row">
          <dt>Observer</dt>
          <dd>
            {observer.lat.toFixed(5)}°, {observer.lon.toFixed(5)}° · ground{' '}
            {observer.groundElevationM.toFixed(1)} m + eye {observer.eyeHeightM.toFixed(2)} m
          </dd>
        </div>
        <div className="claims__row">
          <dt>Camera</dt>
          <dd>
            heading {pose.headingDeg.toFixed(3)}° true · pitch {pose.pitchDeg.toFixed(3)}° · roll{' '}
            {pose.rollDeg.toFixed(3)}°
          </dd>
        </div>
        <div className="claims__row">
          <dt>Optics</dt>
          <dd>
            {pose.hFovDeg.toFixed(3)}° × {pose.vFovDeg.toFixed(3)}° over {frame.widthPx} ×{' '}
            {frame.heightPx} px
          </dd>
        </div>
      </dl>
    </section>
  );
}
