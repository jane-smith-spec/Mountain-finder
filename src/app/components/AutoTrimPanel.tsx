/**
 * P7.4's user-facing half: the auto-align suggestion, visible and declinable.
 *
 * The design rule this component exists to enforce (written on the seam in
 * src/pipeline/cv-alignment.ts): the aligner PRE-SETS nothing by itself. It
 * proposes; the user applies. An automatic correction the user cannot see or
 * undo is strictly worse than a manual one, because when it is wrong there is
 * no way to know anything moved. So the suggestion is a sentence and a button,
 * the button writes the SAME trim state the sliders and the drag write, and a
 * refusal is shown in full rather than rendered as an empty region that reads
 * as "nothing to correct".
 */

import type { TrimSuggestionView } from '../seam';

export interface AutoTrimPanelProps {
  /** Absent while no photo/overlay, or when no suggester is wired. */
  readonly view: TrimSuggestionView | undefined;
  readonly busy: boolean;
  /** Add these to the current trim — the App owns the arithmetic. */
  readonly onApply: (headingTrimDeg: number, pitchTrimDeg: number) => void;
}

function formatTrim(deg: number): string {
  return `${deg >= 0 ? '+' : ''}${deg.toFixed(2)}°`;
}

export function AutoTrimPanel({ view, busy, onApply }: AutoTrimPanelProps): JSX.Element | null {
  if (!busy && view === undefined) return null;

  return (
    <section className="panel" aria-labelledby="auto-trim-heading" data-testid="auto-trim">
      <h2 id="auto-trim-heading">Auto-align</h2>
      {busy ? (
        <p data-testid="auto-trim-state" data-auto-trim="busy">
          Matching the photo’s skyline against the terrain…
        </p>
      ) : view?.status === 'declined' ? (
        <p data-testid="auto-trim-state" data-auto-trim="declined">
          {view.message}
        </p>
      ) : view === undefined ? null : (
        <div data-testid="auto-trim-state" data-auto-trim="suggested">
          <p>
            The skyline match suggests nudging heading {formatTrim(view.headingTrimDeg)} and
            pitch {formatTrim(view.pitchTrimDeg)}.
            {view.tentative ? ' It is a tentative match:' : ''}
          </p>
          {view.concerns.length > 0 ? (
            <ul className="auto-trim__concerns">
              {view.concerns.map((concern) => (
                <li key={concern}>{concern}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            data-testid="auto-trim-apply"
            onClick={() => {
              onApply(view.headingTrimDeg, view.pitchTrimDeg);
            }}
          >
            Apply to the trim sliders
          </button>
          <p className="auto-trim__aside">
            Applying moves the same sliders you can drag — nothing is corrected behind them.
          </p>
        </div>
      )}
    </section>
  );
}
