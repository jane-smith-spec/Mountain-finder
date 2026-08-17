/**
 * How far out the labels might be — decision D9's user-facing half.
 *
 * The banner says three things, in this order, because that is the order they
 * matter to somebody standing on a hill holding a phone:
 *
 *   1. WHAT THE LABELS MEAN. A direction, not an identification. This is the
 *      claim the pose can actually support, and putting it first is the whole
 *      point of D9.
 *   2. HOW FAR OUT. As a share of the picture, which is what a person can see,
 *      with the degrees alongside for anyone who wants them.
 *   3. WHAT TO DO. Drag the overlay.
 *
 * Every figure carries where it came from. Terms with no measured figure are
 * listed too, saying so — a term omitted because it is unknown would make the
 * total read as complete when it is a floor.
 */

import type { PoseUncertainty } from '../uncertainty';

export interface UncertaintyBannerProps {
  uncertainty: PoseUncertainty;
}

function percent(fraction: number): string {
  const value = Math.round(fraction * 100);
  return value === 0 ? '<1%' : `${value}%`;
}

export function UncertaintyBanner({ uncertainty }: UncertaintyBannerProps): JSX.Element {
  const { measuredDeg, frameFraction, pixelsPerDegree, terms, hasUnquantified } = uncertainty;

  return (
    <section className="panel" aria-labelledby="uncertainty-heading" data-testid="uncertainty">
      <h2 id="uncertainty-heading">How close is this?</h2>

      <p className="uncertainty__summary" data-testid="uncertainty-summary">
        {uncertainty.summary}
      </p>

      <dl className="uncertainty__figures">
        <div>
          <dt>Left / right</dt>
          <dd data-testid="uncertainty-horizontal">
            {percent(frameFraction.horizontal)} of the way to the edge
            <span className="uncertainty__aside"> ({measuredDeg.horizontal.toFixed(1)}°)</span>
          </dd>
        </div>
        <div>
          <dt>Up / down</dt>
          <dd data-testid="uncertainty-vertical">
            {percent(frameFraction.vertical)} of the way to the edge
            <span className="uncertainty__aside"> ({measuredDeg.vertical.toFixed(1)}°)</span>
          </dd>
        </div>
        <div>
          <dt>Drag scale</dt>
          {/* The one figure here with no assumption in it at all: pure
              projection arithmetic, so the user knows what a nudge does. */}
          <dd data-testid="uncertainty-scale">
            1° ≈ {Math.round(pixelsPerDegree.horizontal)} px across,{' '}
            {Math.round(pixelsPerDegree.vertical)} px down
          </dd>
        </div>
      </dl>

      <details className="uncertainty__detail">
        <summary>Where these numbers come from</summary>
        <ul>
          {terms.map((term) => (
            <li key={term.label} data-testid={`uncertainty-term-${term.axis}`}>
              <strong>{term.label}</strong>
              {term.basis.kind === 'measured' ? (
                <>
                  {' — '}
                  {term.basis.deg.toFixed(1)}°, from {term.basis.sampleCount}{' '}
                  {term.basis.sampleCount === 1 ? 'measurement' : 'measurements'}.{' '}
                  {term.basis.note}
                </>
              ) : (
                <> — no measured figure. {term.basis.note}</>
              )}
            </li>
          ))}
        </ul>
        {hasUnquantified ? (
          <p data-testid="uncertainty-floor">
            Because at least one of those has no figure, the totals above are a{' '}
            <strong>minimum</strong>, not a limit.
          </p>
        ) : null}
      </details>
    </section>
  );
}
