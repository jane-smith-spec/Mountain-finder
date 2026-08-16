/**
 * Presentation metadata for the nine pose fields — pure, no React.
 *
 * The override panel's whole job is to be honest about where every number came
 * from, so the vocabulary lives here in one place: what a field is called, how
 * it is formatted, what its provenance badge says, and what each
 * `MissingReason` means in words a person can act on.
 *
 * Nothing in this file invents a value. `formatFieldValue` formats what it is
 * given; a field with no value formats to the empty string, never to "0".
 */

import { POSE_FIELDS, type FieldSource, type MissingReason, type PoseField } from '../exif';

export interface PoseFieldMeta {
  /** Human label for the input. */
  readonly label: string;
  /** Unit suffix shown next to the label. */
  readonly unit: string;
  /** Decimal places used when displaying a value. State keeps full precision. */
  readonly decimals: number;
  /** `step` attribute for the number input. */
  readonly step: number;
  /** Which half of the pose this belongs to. */
  readonly group: 'observer' | 'camera';
  /** One line of help, shown under the input. */
  readonly hint: string;
}

export const POSE_FIELD_META: Readonly<Record<PoseField, PoseFieldMeta>> = {
  lat: {
    label: 'Latitude',
    unit: '°',
    decimals: 6,
    step: 0.000001,
    group: 'observer',
    hint: 'Signed decimal degrees; negative south of the equator.',
  },
  lon: {
    label: 'Longitude',
    unit: '°',
    decimals: 6,
    step: 0.000001,
    group: 'observer',
    hint: 'Signed decimal degrees; negative west of Greenwich.',
  },
  groundElevationM: {
    label: 'Ground elevation',
    unit: 'm',
    decimals: 1,
    step: 0.1,
    group: 'observer',
    hint: 'Terrain height under your feet, above sea level.',
  },
  eyeHeightM: {
    label: 'Eye height',
    unit: 'm',
    decimals: 2,
    step: 0.01,
    group: 'observer',
    hint: 'Camera above that terrain — about 1.6 m handheld.',
  },
  headingDeg: {
    label: 'Heading',
    unit: '° true',
    decimals: 3,
    step: 0.1,
    group: 'camera',
    hint: 'Where the lens pointed, referenced to TRUE north.',
  },
  pitchDeg: {
    label: 'Pitch',
    unit: '°',
    decimals: 3,
    step: 0.1,
    group: 'camera',
    hint: 'Positive tilts up toward the sky.',
  },
  rollDeg: {
    label: 'Roll',
    unit: '°',
    decimals: 3,
    step: 0.1,
    group: 'camera',
    hint: 'Frame rotation; 0 for a level photo.',
  },
  hFovDeg: {
    label: 'Horizontal field of view',
    unit: '°',
    decimals: 3,
    step: 0.1,
    group: 'camera',
    hint: 'Derived from the 35 mm-equivalent focal length when the photo records one.',
  },
  vFovDeg: {
    label: 'Vertical field of view',
    unit: '°',
    decimals: 3,
    step: 0.1,
    group: 'camera',
    hint: 'Follows from the horizontal field of view and the image aspect ratio.',
  },
};

/** Short badge text for a resolved field's provenance. */
export const SOURCE_BADGE: Readonly<Record<FieldSource, string>> = {
  user: 'You',
  exif: 'EXIF',
  default: 'Assumed',
};

/** Longer explanation of a provenance badge, used as the badge's title/aria text. */
export const SOURCE_DESCRIPTION: Readonly<Record<FieldSource, string>> = {
  user: 'You typed this value.',
  exif: "Read from the photo's own metadata.",
  default: 'A standard assumption you opted into — not measured, not from the photo.',
};

/** What each missing reason means, in words the panel can act on. */
export const REASON_TEXT: Readonly<Record<MissingReason, string>> = {
  'absent-from-exif': 'This photo does not record it. Type a value.',
  'magnetic-declination-required':
    'The photo records a MAGNETIC bearing. Supply the magnetic declination below, or type a true-north heading — a magnetic bearing is never treated as true north.',
  'direction-reference-unknown':
    'The photo records a direction but not whether it is true or magnetic, so it cannot be used as either.',
  'no-35mm-equivalent-focal-length':
    'Only a physical focal length is recorded; without the sensor size there is no field of view.',
  'image-dimensions-unknown': 'Needs the image pixel dimensions to derive the aspect ratio.',
  'eye-height-required':
    'GPS altitude is the camera’s altitude. Set an eye height so the terrain height under it can be worked out.',
  // Added with the 'out-of-range' MissingReason (src/exif/types.ts): a value
  // that WAS supplied and cannot be true is now reported rather than silently
  // replaced by the next precedence layer. Reword freely — this is the panel's
  // prose, not the resolver's.
  'out-of-range':
    'That value is outside what this field can mean, so it has not been used. Check it and type it again — nothing was substituted for it.',
};

const TRAILING_ZEROS = /\.?0+$/;

/**
 * Round for display without lying about precision: trailing zeros are dropped,
 * so 137.250 shows as "137.25" and 45.923700 as "45.9237".
 *
 * `undefined` formats to '' — an empty input is the honest rendering of "we do
 * not know", and is exactly what stops a needs-manual field showing a zero.
 */
export function formatFieldValue(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(TRAILING_ZEROS, '') : fixed;
}

/** The nine fields split into the two panel sections, in POSE_FIELDS order. */
export function fieldsInGroup(group: PoseFieldMeta['group']): readonly PoseField[] {
  return POSE_FIELDS.filter((field) => POSE_FIELD_META[field].group === group);
}
