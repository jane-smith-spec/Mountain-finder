/**
 * The obscured-summit switch (decision D8).
 *
 * A summit can be hidden in two physically different ways, and the app treats
 * them as two different things rather than one "hidden" bucket:
 *
 *   behind ITS OWN hill      the hill fills the view, unmistakably there, with
 *                            only the last few metres of its top tucked behind
 *                            its own curve. Naming it is information. This
 *                            switch decides whether it is drawn, greyed — and
 *                            it defaults to ON, which is the user's call.
 *
 *   behind a DIFFERENT hill  the mountain is not in the photograph at all.
 *                            Never drawn, in either position of this switch,
 *                            and deliberately not offered as an option: it
 *                            would be the app inventing a mountain.
 *
 * The copy is `obscuredPeaksNote` from state.ts, tested there, for the same
 * reason the provenance wording lives in `pose-fields.ts`: what the UI claims
 * about the system is a rule that can be wrong, so it gets a test rather than
 * being typed into JSX and hoped over.
 */

import { obscuredPeaksNote } from '../state';

export interface ObscuredPeaksControlProps {
  showObscuredPeaks: boolean;
  onToggle: (enabled: boolean) => void;
}

export function ObscuredPeaksControl({
  showObscuredPeaks,
  onToggle,
}: ObscuredPeaksControlProps): JSX.Element {
  return (
    <section className="panel" aria-labelledby="obscured-heading">
      <h2 id="obscured-heading">5. Obscured summits</h2>
      <div className="options__row">
        <label className="options__checkbox" htmlFor="show-obscured">
          <input
            id="show-obscured"
            data-testid="input-show-obscured"
            type="checkbox"
            checked={showObscuredPeaks}
            aria-describedby="obscured-help"
            onChange={(event) => {
              onToggle(event.target.checked);
            }}
          />
          Label summits hidden behind their own hill
        </label>
        <p
          className="field__state"
          id="obscured-help"
          data-testid="obscured-note"
          data-showing={String(showObscuredPeaks)}
        >
          {obscuredPeaksNote(showObscuredPeaks)}
        </p>
        <p className="field__state">
          A greyed label is marked four ways, not by colour alone: a dashed pole, a hollow summit
          ring, reduced opacity, and the words <em>summit obscured</em> in the label itself.
        </p>
      </div>
    </section>
  );
}
