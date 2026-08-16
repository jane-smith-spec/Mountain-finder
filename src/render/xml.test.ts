import { describe, expect, it } from 'vitest';

import { attributes, escapeXml, formatCoordinate } from './xml';

describe('escapeXml', () => {
  it('escapes all five predefined entities', () => {
    expect(escapeXml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('escapes the ampersand first, so entities are not double-escaped', () => {
    // The failure this guards: replacing '<' first yields '&lt;', and a later
    // '&' pass then turns it into '&amp;lt;', which renders as the literal
    // text "&lt;" instead of a less-than sign.
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });

  it("survives the real OSM names that motivated it", () => {
    expect(escapeXml("Dent d'Hérens")).toBe('Dent d&apos;Hérens');
    expect(escapeXml('Cima Tosa & Brenta')).toBe('Cima Tosa &amp; Brenta');
  });

  it('leaves non-ASCII letters alone — the document is UTF-8', () => {
    expect(escapeXml('Zugspitze · Grünhorn · Ōyama')).toBe('Zugspitze · Grünhorn · Ōyama');
  });

  it('drops C0 control characters, which XML 1.0 cannot represent at all', () => {
    expect(escapeXml('Piz\u0001\u001f Bernina')).toBe('Piz Bernina');
  });

  it('keeps tab, newline and carriage return, which are legal', () => {
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('is idempotent on text with nothing to escape', () => {
    expect(escapeXml('Matterhorn 4478 m')).toBe('Matterhorn 4478 m');
  });
});

describe('formatCoordinate', () => {
  it('rounds to two decimals', () => {
    // 1600·(√3 − 1) — the x of the P4.1 geometric fixture, to two decimals.
    expect(formatCoordinate(1171.2812921102036)).toBe('1171.28');
    expect(formatCoordinate(524.8199528704451)).toBe('524.82');
  });

  it('rounds halves toward positive infinity, as Math.round does', () => {
    expect(formatCoordinate(0.005)).toBe('0.01');
    expect(formatCoordinate(2.345)).toBe('2.35');
    // −0.5 rounds to −0, which the negative-zero rule then normalises.
    expect(formatCoordinate(-0.005)).toBe('0');
  });

  it('drops trailing zeros rather than padding', () => {
    expect(formatCoordinate(600)).toBe('600');
    expect(formatCoordinate(1.5)).toBe('1.5');
  });

  it('normalises negative zero', () => {
    expect(formatCoordinate(-0)).toBe('0');
    expect(formatCoordinate(-0.001)).toBe('0');
  });

  it('keeps genuinely negative values negative', () => {
    expect(formatCoordinate(-12.346)).toBe('-12.35');
  });

  it('refuses non-finite values instead of emitting a NaN attribute', () => {
    // An attribute of `x="NaN"` makes the element silently disappear.
    expect(() => formatCoordinate(Number.NaN)).toThrow(RangeError);
    expect(() => formatCoordinate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('attributes', () => {
  it('emits a leading space before each pair and escapes values', () => {
    expect(attributes({ id: 'a', 'data-name': "d'Hérens" })).toBe(
      ' id="a" data-name="d&apos;Hérens"',
    );
  });

  it('formats numeric values as coordinates', () => {
    // 1.015625 = 1 + 1/64 is exactly representable in binary, so 1.015625 × 100
    // is exactly 101.5625 and the rounding is unambiguous: 102 → 1.02.
    expect(attributes({ x: 1.015625, y: -0 })).toBe(' x="1.02" y="0"');
  });

  it('rounds a half that binary cannot represent to whatever the double is', () => {
    // 1.005 is NOT representable in IEEE 754. The nearest double is
    // 1.00499999999999989341858963598497211933135986328125, so 1.005 * 100
    // evaluates to 100.49999999999999 and Math.round gives 100 → "1", not
    // "1.01". That is binary floating point working correctly, not a rounding
    // bug, and it is recorded here so the next reader does not "fix" it.
    //
    // It is deliberately left alone rather than papered over with an epsilon
    // nudge or a decimal-rounding routine: the whole discrepancy is half a
    // hundredth of a pixel — five parts per million of a 1600 px frame, far
    // below anything that can be displayed — and this runs once per coordinate
    // for every point of every polyline.
    expect(attributes({ x: 1.005 })).toBe(' x="1"');
  });

  it('is empty for an empty map', () => {
    expect(attributes({})).toBe('');
  });
});
