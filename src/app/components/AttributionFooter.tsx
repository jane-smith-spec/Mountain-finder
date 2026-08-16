/**
 * The attribution footer — the app's visible data credit.
 *
 * ODbL-1.0 requires the notice to be shown to *users of the app*, so this is a
 * compliance surface, not decoration. Three consequences shape it:
 *
 *   1. It renders with no interaction and no fetch. Everything it says is
 *      derived at build time from citation records that are already in the
 *      bundle (`data-credits.ts`), so it is on screen at first paint even when
 *      /terrain/ is unreachable and no photo has been loaded.
 *   2. It sticks to the bottom of the viewport (`position: sticky`). A credit
 *      that only appears after scrolling past a loaded photo is a credit most
 *      people never see, and "most people never see it" is the failure this
 *      exists to prevent. Sticky rather than fixed, so it still ends the
 *      document rather than covering the last control.
 *   3. Required and courtesy credits are distinguished in WORDS
 *      ("Attribution required by ODbL-1.0" vs "credit is courtesy"), never by
 *      colour — the same rule the provenance badges follow.
 *
 * The text itself is not typed here. `deriveCredits` reads what the shipped
 * data says about itself, so a region imported under a different licence
 * changes this footer without changing this file.
 */

import {
  creditLine,
  deriveCredits,
  obligationNote,
  type Credit,
} from '../attribution';
import { APP_DATA_USES } from '../data-credits';

/** Derived once, at module scope: it is a function of the bundle, not of state. */
export const APP_CREDITS: readonly Credit[] = deriveCredits(APP_DATA_USES);

export interface AttributionFooterProps {
  /** Overridable so the derivation can be driven from a test. */
  credits?: readonly Credit[];
}

export function AttributionFooter({
  credits = APP_CREDITS,
}: AttributionFooterProps = {}): JSX.Element {
  return (
    <footer className="app__footer" data-testid="attribution" aria-labelledby="attribution-heading">
      <h2 className="app__footer-heading" id="attribution-heading">
        Data and licences
      </h2>
      <ul className="credits">
        {credits.map((credit) => (
          <li
            className="credit"
            key={`${credit.what}|${credit.detail}`}
            data-testid="credit"
            data-what={credit.what}
            data-licence={credit.licence?.id ?? 'none'}
            data-notice-required={String(credit.noticeRequired)}
          >
            <span className="credit__what">
              {credit.what} <span className="credit__detail">— {credit.detail}</span>
            </span>
            <span className="credit__body">
              <span className="credit__line" data-testid="credit-line">
                {creditLine(credit)}
              </span>{' '}
              <span className="credit__obligation">{obligationNote(credit)}</span>
              {credit.links.length === 0 ? null : (
                <span className="credit__links">
                  {credit.links.map((link) => (
                    <a
                      className="credit__link"
                      href={link.url}
                      key={link.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {link.label}
                    </a>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
