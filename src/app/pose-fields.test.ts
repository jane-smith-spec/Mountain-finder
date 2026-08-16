/**
 * Presentation rules for the override panel.
 *
 * The important test in here is the first one: an unknown value must format to
 * the empty string. A "0" in a heading box is a real bearing (due north) and a
 * "0" in an elevation box is sea level — rendering either for "we do not know"
 * is precisely the silent invention this app exists to avoid.
 */

import { describe, expect, it } from 'vitest';

import { POSE_FIELDS, type FieldSource, type MissingReason } from '../exif';
import {
  fieldsInGroup,
  formatFieldValue,
  POSE_FIELD_META,
  REASON_TEXT,
  SOURCE_BADGE,
  SOURCE_DESCRIPTION,
} from './pose-fields';

const ALL_REASONS: readonly MissingReason[] = [
  'absent-from-exif',
  'magnetic-declination-required',
  'direction-reference-unknown',
  'no-35mm-equivalent-focal-length',
  'image-dimensions-unknown',
  'eye-height-required',
];

const ALL_SOURCES: readonly FieldSource[] = ['user', 'exif', 'default'];

describe('formatFieldValue', () => {
  it('renders an unknown value as an empty box, never as zero', () => {
    expect(formatFieldValue(undefined, 3)).toBe('');
    expect(formatFieldValue(Number.NaN, 3)).toBe('');
  });

  it('renders a genuine zero as "0"', () => {
    expect(formatFieldValue(0, 3)).toBe('0');
  });

  it('drops trailing zeros so a rounded value does not claim false precision', () => {
    expect(formatFieldValue(137.25, 3)).toBe('137.25');
    expect(formatFieldValue(45.9237, 6)).toBe('45.9237');
    expect(formatFieldValue(1033.9, 1)).toBe('1033.9');
  });

  it('rounds to the field’s declared decimals', () => {
    // 69.39030706246794 = 2·atan(36/52), the hFov of a 26 mm-equivalent lens.
    expect(formatFieldValue(69.39030706246794, 3)).toBe('69.39');
    expect(formatFieldValue(69.39030706246794, 6)).toBe('69.390307');
  });

  it('keeps the sign of a negative value', () => {
    expect(formatFieldValue(-424.5, 1)).toBe('-424.5');
  });
});

describe('field metadata', () => {
  it('covers all nine pose fields', () => {
    expect(Object.keys(POSE_FIELD_META).sort()).toEqual([...POSE_FIELDS].sort());
  });

  it('splits into four observer fields and five camera fields', () => {
    expect(fieldsInGroup('observer')).toEqual(['lat', 'lon', 'groundElevationM', 'eyeHeightM']);
    expect(fieldsInGroup('camera')).toEqual([
      'headingDeg',
      'pitchDeg',
      'rollDeg',
      'hFovDeg',
      'vFovDeg',
    ]);
  });
});

describe('provenance vocabulary', () => {
  it('gives every source a distinct badge and an explanation', () => {
    const badges = ALL_SOURCES.map((source) => SOURCE_BADGE[source]);
    expect(new Set(badges).size).toBe(ALL_SOURCES.length);
    for (const source of ALL_SOURCES) {
      expect(SOURCE_DESCRIPTION[source].length).toBeGreaterThan(10);
    }
  });

  it('gives every missing reason actionable prose', () => {
    for (const reason of ALL_REASONS) {
      expect(REASON_TEXT[reason].length).toBeGreaterThan(10);
    }
    expect(new Set(ALL_REASONS.map((reason) => REASON_TEXT[reason])).size).toBe(ALL_REASONS.length);
  });

  it('names the magnetic case explicitly — it is the one that must never be silent', () => {
    expect(REASON_TEXT['magnetic-declination-required']).toMatch(/MAGNETIC/);
    expect(REASON_TEXT['magnetic-declination-required']).toMatch(/declination/i);
  });
});
