/**
 * Manual fine-alignment sliders (decision D3: automatic skyline alignment is
 * v2.1, so the base product nudges by hand).
 *
 * Each slider is a native `<input type="range">` — keyboard-operable with the
 * arrow keys out of the box, one press per `TRIM_STEP_DEG` — with a visible
 * live readout of the offset and of the value the overlay will actually use.
 * The trim is shown as an offset, never folded into the pose fields above, so
 * "EXIF said 137.25°" and "you nudged +1.5°" stay separate facts.
 */

import type { CameraPose } from '../../core/types';
import { isUntrimmed, TRIM_LIMIT_DEG, TRIM_STEP_DEG, type TrimState } from '../trim';

export interface TrimSlidersProps {
  trim: TrimState;
  onTrimChange: (axis: keyof TrimState, valueDeg: number) => void;
  onReset: () => void;
  /** The pose before trim, when the pose is complete. */
  basePose?: CameraPose;
  /** The pose after trim — what the overlay consumes. */
  effectivePose?: CameraPose;
}

interface SliderSpec {
  readonly axis: keyof TrimState;
  readonly label: string;
  readonly describe: (base: CameraPose, effective: CameraPose) => string;
}

const SLIDERS: readonly SliderSpec[] = [
  {
    axis: 'headingDeg',
    label: 'Heading trim',
    describe: (base, effective) =>
      `${base.headingDeg.toFixed(2)}° → ${effective.headingDeg.toFixed(2)}° true`,
  },
  {
    axis: 'pitchDeg',
    label: 'Pitch trim',
    describe: (base, effective) => `${base.pitchDeg.toFixed(2)}° → ${effective.pitchDeg.toFixed(2)}°`,
  },
  {
    axis: 'hFovDeg',
    label: 'Field-of-view trim',
    describe: (base, effective) =>
      `${base.hFovDeg.toFixed(2)}° → ${effective.hFovDeg.toFixed(2)}° wide ` +
      `(vertical ${effective.vFovDeg.toFixed(2)}°)`,
  },
];

const signed = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)}°`;

export function TrimSliders({
  trim,
  onTrimChange,
  onReset,
  basePose,
  effectivePose,
}: TrimSlidersProps): JSX.Element {
  return (
    <section className="panel" aria-labelledby="trim-heading">
      <h2 id="trim-heading">4. Fine alignment</h2>
      <p className="status">
        Nudge the alignment by hand. Automatic skyline matching is deferred to v2.1 (decision D3).
      </p>
      {SLIDERS.map((spec) => {
        const limit = TRIM_LIMIT_DEG[spec.axis];
        const value = trim[spec.axis];
        const id = `trim-${spec.axis}`;
        return (
          <div className="slider" key={spec.axis} data-testid={`slider-row-${spec.axis}`}>
            <label className="slider__label" htmlFor={id}>
              {spec.label}
            </label>
            <input
              id={id}
              data-testid={`trim-${spec.axis}`}
              className="slider__input"
              type="range"
              min={-limit}
              max={limit}
              step={TRIM_STEP_DEG}
              value={value}
              aria-describedby={`${id}-readout`}
              aria-valuetext={`${signed(value)} degrees`}
              onChange={(event) => {
                onTrimChange(spec.axis, Number(event.target.value));
              }}
            />
            <output
              className="slider__readout"
              id={`${id}-readout`}
              htmlFor={id}
              data-testid={`trim-${spec.axis}-readout`}
              data-trim-deg={String(value)}
            >
              {signed(value)}
              {basePose !== undefined && effectivePose !== undefined && (
                <span className="slider__detail">{spec.describe(basePose, effectivePose)}</span>
              )}
            </output>
          </div>
        );
      })}
      <button
        type="button"
        className="button"
        data-testid="trim-reset"
        disabled={isUntrimmed(trim)}
        onClick={onReset}
      >
        Reset trim
      </button>
    </section>
  );
}
