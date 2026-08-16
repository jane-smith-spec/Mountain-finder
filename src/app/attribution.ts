/**
 * DATA ATTRIBUTION — derived from the data's own citation records.
 *
 * ## Why this is code rather than a sentence in the JSX
 *
 * The summit database ships under **ODbL-1.0** (© OpenStreetMap contributors,
 * via Overture Maps). That licence requires the notice to be *shown to users of
 * the app* — it is a condition, not a courtesy, and a generated
 * `dist/ATTRIBUTION.txt` that nothing links to does not discharge it
 * (docs/DEPLOY.md). So the notice is rendered in the page.
 *
 * A hard-coded sentence would be the obvious way to do that, and it is the
 * wrong way: it drifts the moment the data changes. Every dataset in this
 * repository already carries `sources[]` records with a title, a URL and a
 * retrieval date — `scripts/package-deploy.ts` writes ATTRIBUTION.txt straight
 * out of them — so the app reads the *same* records and derives what it must
 * display. Add a region under a different licence and the footer follows it; no
 * region, no notice; a region whose citation names no licence gets its sources
 * listed and no licence claimed on its behalf.
 *
 * ## What is derived, and from what
 *
 *   licence   matched against KNOWN_LICENCES over the citation's title + note.
 *             `ODbL` without a version reports `ODbL` — the version is never
 *             invented, because a licence id is a legal claim.
 *   holder    the `©` clause of the citation ("© OpenStreetMap contributors").
 *   publisher the first clause of the title ("Overture Maps Foundation, base
 *             theme, …" → "Overture Maps Foundation"), collected only from
 *             citations that carry a licence or a holder, because for a list of
 *             fifteen Wikipedia articles the first clause is the article name.
 *   origins   the hostnames of the citation URLs — the fallback for exactly
 *             that case, so a purely factual source still says where it is from.
 *
 * ## Pure
 *
 * No DOM, no fetch, no clock. Strings in, strings out, unit-tested in
 * `attribution.test.ts` against hand-written citations AND against the real
 * shipped ones (`data-credits.ts`).
 */

/** One citation, in the shape every dataset in this repository writes it. */
export interface CitationRecord {
  readonly title: string;
  readonly url?: string;
  readonly note?: string;
}

/** A licence the app can recognise by name in a citation. */
export interface LicenceRef {
  /** As written in the licence itself, e.g. `ODbL-1.0`. */
  readonly id: string;
  readonly url?: string;
  /**
   * True when the licence obliges a notice visible to users (ODbL, CC-BY);
   * false for public-domain-equivalent terms, where credit is courtesy.
   * The distinction is rendered in words, never by colour alone.
   */
  readonly requiresNotice: boolean;
}

/** A body of data the app holds, and what it is used for. */
export interface DataUse {
  /** What it supplies: "Elevation", "Summits". */
  readonly what: string;
  /** How this build uses it — stated plainly, including "not read yet". */
  readonly detail: string;
  readonly sources: readonly CitationRecord[];
}

/** A link the footer offers for a credit. */
export interface CreditLink {
  readonly label: string;
  readonly url: string;
}

/** One rendered credit: everything the footer says about one body of data. */
export interface Credit {
  readonly what: string;
  readonly detail: string;
  /** Copyright holders named in the citations, without the `©`. */
  readonly holders: readonly string[];
  /** Who published the dataset the app actually reads. */
  readonly publishers: readonly string[];
  /** Hostnames of the citation URLs — used when nothing else identifies them. */
  readonly origins: readonly string[];
  readonly licence?: LicenceRef;
  /** True iff a licence here obliges the notice. Drives the wording. */
  readonly noticeRequired: boolean;
  readonly links: readonly CreditLink[];
}

/**
 * Licences this app can name, most specific first (CC-BY-SA must be tried
 * before CC-BY, and a versioned ODbL before a bare one). Anything not listed
 * here is reported as "licence not named in the citation" rather than guessed:
 * inventing a licence id would be worse than admitting the citation is thin.
 */
const KNOWN_LICENCES: readonly (LicenceRef & { readonly match: RegExp })[] = [
  {
    id: 'ODbL-1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    requiresNotice: true,
    match: /\bodbl[\s-]*(?:v)?1\.0\b/i,
  },
  {
    id: 'ODbL',
    url: 'https://opendatacommons.org/licenses/odbl/',
    requiresNotice: true,
    match: /\bodbl\b/i,
  },
  {
    id: 'CC-BY-SA-4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    requiresNotice: true,
    match: /\bcc[\s-]?by[\s-]?sa[\s-]?4\.0\b/i,
  },
  {
    id: 'CC-BY-4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    requiresNotice: true,
    match: /\bcc[\s-]?by[\s-]?4\.0\b/i,
  },
  {
    id: 'CC0-1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    requiresNotice: false,
    match: /\bcc0\b/i,
  },
  {
    id: 'PDDL-1.0',
    url: 'https://opendatacommons.org/licenses/pddl/1-0/',
    requiresNotice: false,
    match: /\bpddl\b/i,
  },
  {
    id: 'public domain',
    requiresNotice: false,
    match: /\bpublic domain\b/i,
  },
];

/** Extra links a named holder is worth offering. */
const HOLDER_LINKS: readonly { readonly match: RegExp; readonly link: CreditLink }[] = [
  {
    match: /openstreetmap/i,
    link: { label: 'OpenStreetMap copyright', url: 'https://www.openstreetmap.org/copyright' },
  },
];

/** Everything a citation says, as one searchable string. */
function citationText(source: CitationRecord): string {
  return [source.title, source.note ?? ''].join(' ');
}

/** The licence a citation names, or undefined if it names none. */
export function detectLicence(source: CitationRecord): LicenceRef | undefined {
  const text = citationText(source);
  for (const candidate of KNOWN_LICENCES) {
    if (!candidate.match.test(text)) continue;
    return candidate.url === undefined
      ? { id: candidate.id, requiresNotice: candidate.requiresNotice }
      : { id: candidate.id, url: candidate.url, requiresNotice: candidate.requiresNotice };
  }
  return undefined;
}

/**
 * Copyright holders a citation names, without the `©`.
 *
 * Stops at the clause boundary, so "© OpenStreetMap contributors, ODbL-1.0"
 * yields the holder and not the licence that follows it.
 */
export function detectHolders(source: CitationRecord): readonly string[] {
  const holders: string[] = [];
  const pattern = /(?:©|\(c\)|copyright)\s*([^,;.()]+)/gi;
  for (const match of citationText(source).matchAll(pattern)) {
    const holder = match[1]?.trim();
    if (holder !== undefined && holder !== '' && !holders.includes(holder)) holders.push(holder);
  }
  return holders;
}

/** The first clause of a citation title — who published the dataset. */
export function publisherOf(source: CitationRecord): string {
  const [head] = source.title.split(/[,—–:]/u);
  return (head ?? source.title).trim();
}

/** The hostname of a citation URL, or undefined if it has none / is unparseable. */
function hostOf(source: CitationRecord): string | undefined {
  if (source.url === undefined) return undefined;
  try {
    return new URL(source.url).hostname;
  } catch {
    return undefined;
  }
}

function pushUnique(into: string[], value: string): void {
  if (value !== '' && !into.includes(value)) into.push(value);
}

/**
 * Turn one body of data into the credit the footer renders for it.
 *
 * The strongest signal wins: a citation that names a licence and a holder
 * identifies itself, so its publisher is named too; a citation that names
 * neither (a Wikipedia article backing one summit's height) contributes only
 * its hostname, because listing fifteen article titles is not attribution, it
 * is noise.
 */
export function deriveCredit(use: DataUse): Credit {
  const holders: string[] = [];
  const publishers: string[] = [];
  const origins: string[] = [];
  const links: CreditLink[] = [];
  let licence: LicenceRef | undefined;
  let noticeRequired = false;

  for (const source of use.sources) {
    const sourceLicence = detectLicence(source);
    const sourceHolders = detectHolders(source);

    // The strictest licence in a body of data governs how it is credited: if
    // any one region is ODbL, the notice is required for the whole credit.
    if (sourceLicence !== undefined) {
      if (licence === undefined || (sourceLicence.requiresNotice && !licence.requiresNotice)) {
        licence = sourceLicence;
      }
      if (sourceLicence.requiresNotice) noticeRequired = true;
      if (sourceLicence.url !== undefined) {
        if (!links.some((link) => link.url === sourceLicence.url)) {
          links.push({ label: sourceLicence.id, url: sourceLicence.url });
        }
      }
    }

    for (const holder of sourceHolders) {
      pushUnique(holders, holder);
      for (const candidate of HOLDER_LINKS) {
        if (candidate.match.test(holder) && !links.some((l) => l.url === candidate.link.url)) {
          links.push(candidate.link);
        }
      }
    }

    if (sourceLicence !== undefined || sourceHolders.length > 0) {
      pushUnique(publishers, publisherOf(source));
    }

    const host = hostOf(source);
    if (host !== undefined) pushUnique(origins, host);
  }

  return {
    what: use.what,
    detail: use.detail,
    holders,
    publishers,
    origins,
    ...(licence === undefined ? {} : { licence }),
    noticeRequired,
    links,
  };
}

/**
 * Obligations first, courtesies after, order otherwise preserved.
 *
 * Not cosmetic. On a short viewport the footer is the part of the page most
 * likely to be clipped, and the credit that MUST be read is the one a licence
 * requires — so it is the one that cannot end up last. A stable partition
 * rather than a sort, so two required credits keep the order the data gave.
 */
export function orderCredits(credits: readonly Credit[]): readonly Credit[] {
  return [
    ...credits.filter((credit) => credit.noticeRequired),
    ...credits.filter((credit) => !credit.noticeRequired),
  ];
}

export function deriveCredits(uses: readonly DataUse[]): readonly Credit[] {
  return orderCredits(uses.map(deriveCredit));
}

/**
 * The credit itself, as one line — the thing ODbL-1.0 obliges the app to show.
 *
 * With a named holder it reads the way an OSM-derived credit conventionally
 * does, which is also the sentence docs/DEPLOY.md asks for:
 *
 *   © OpenStreetMap contributors, ODbL-1.0, via Overture Maps Foundation
 *
 * With no holder there is nobody to lead with, so the publisher does:
 *
 *   NASA/USGS SRTM 1 arc-second — public domain
 */
export function creditLine(credit: Credit): string {
  if (credit.holders.length > 0) {
    const parts = [credit.holders.map((holder) => `© ${holder}`).join(', ')];
    if (credit.licence !== undefined) parts.push(credit.licence.id);
    if (credit.publishers.length > 0) parts.push(`via ${credit.publishers.join(', ')}`);
    return parts.join(', ');
  }
  const lead = credit.publishers.length > 0 ? credit.publishers : credit.origins;
  const head = lead.join(', ');
  if (credit.licence === undefined) return head;
  return head === '' ? credit.licence.id : `${head} — ${credit.licence.id}`;
}

/**
 * Why this credit is on the page: a licence condition, or a courtesy.
 *
 * Rendered as words next to every credit so the distinction survives greyscale,
 * a screen reader and a colour-blind reader — the same rule the provenance
 * badges follow.
 */
export function obligationNote(credit: Credit): string {
  if (credit.noticeRequired) {
    const named = credit.licence?.id ?? 'the licence';
    return `Attribution required by ${named}.`;
  }
  // The licence id is already in the credit line; repeating it here would just
  // say "public domain public domain".
  if (credit.licence !== undefined) return 'Credit is courtesy, not a condition.';
  return 'Cited facts, no licence attached — credit is courtesy.';
}

/**
 * The whole notice as plain text: what the page says, minus the markup.
 *
 * Used by the unit test and available to anything that needs the notice without
 * a DOM (an export caption, a CLI). It is the same derivation the footer
 * renders, so a test on this text is a test on what a user sees.
 */
export function attributionText(credits: readonly Credit[]): string {
  return credits
    .map((credit) => `${credit.what} — ${credit.detail}: ${creditLine(credit)} ${obligationNote(credit)}`)
    .join('\n');
}
