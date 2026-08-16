/**
 * The two string primitives every SVG emitter needs: escaping text so it cannot
 * break the document, and formatting numbers so the document is stable.
 *
 * Both are here rather than inlined in the builder because both are places
 * where a plausible-looking shortcut produces broken output only for *some*
 * inputs — an ampersand in a peak name, a coordinate that happens to land on
 * `-0` — which is exactly the class of bug that survives a manual eyeball.
 */

/**
 * Escape a string for use as XML character data or as an attribute value.
 *
 * All five predefined entities are escaped, not just the three that are
 * strictly required in text nodes, so the same function is safe in both
 * positions. Real OSM peak names make this mandatory, not defensive:
 * `Dent d'Hérens` carries an apostrophe and `Cima Brenta & Tosa`-style names
 * carry ampersands; emitted raw into an attribute the first breaks the quoting
 * and the second is an undefined entity reference. Either produces an SVG that
 * a browser refuses to parse, and `<img src=data:image/svg+xml,…>` fails
 * *silently* — a blank overlay with no error anywhere.
 *
 * The ampersand is replaced first, because replacing it after `<` → `&lt;`
 * would go on to double-escape the entity it just wrote.
 *
 * Characters that XML 1.0 forbids outright (the C0 controls other than tab,
 * newline and carriage return) have no escape — `&#1;` is just as illegal as a
 * raw byte 1 — so they are dropped. Non-ASCII text (é, ü, ō) is left alone: the
 * document is UTF-8 and those characters are perfectly legal in it.
 */
export function escapeXml(value: string): string {
  return value
    // Matching these IS the point: XML 1.0 forbids them outright and gives them no
    // escape, so they must be dropped rather than encoded.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Decimal places kept on every coordinate written into the SVG. */
export const COORDINATE_DECIMALS = 2;

/**
 * Format a number for an SVG geometry attribute.
 *
 * Rounded to {@link COORDINATE_DECIMALS} because a coordinate written as
 * `1171.2812921102035` makes snapshot diffs hostage to the last bit of a
 * `Math.tan`, and a hundredth of a pixel is far below anything visible. Two
 * decimals on a 4000 px-wide photo is a precision of 2.5 ppm — three orders of
 * magnitude tighter than the ±0.5 % this renderer is held to.
 *
 * Negative zero is normalised to `0`: `String(-0)` is `"0"` in JavaScript but
 * `Math.round(-0.001 * 100) / 100` is `-0`, and it is one `toFixed` refactor
 * away from emitting `-0.00` and churning a snapshot for no reason.
 *
 * @throws RangeError on a non-finite value — a `NaN` coordinate silently makes
 *   a whole SVG element vanish, which is the worst possible failure mode here.
 */
export function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot format non-finite coordinate: ${value}`);
  }
  const scale = 10 ** COORDINATE_DECIMALS;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Render an attribute map as ` key="value"`, escaping every value. */
export function attributes(map: Readonly<Record<string, string | number>>): string {
  return Object.entries(map)
    .map(([key, value]) => {
      const text = typeof value === 'number' ? formatCoordinate(value) : value;
      return ` ${key}="${escapeXml(text)}"`;
    })
    .join('');
}
