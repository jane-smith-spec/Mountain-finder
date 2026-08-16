import { describe, expect, it } from 'vitest';

import type { CameraPose, HorizonPoint, HorizonProfile, VisiblePeak } from '../core/types';
import { layoutOverlay } from './layout';
import { DEFAULT_THEME, buildOverlaySvg, buildOverlaySvgFromLayout } from './svg';
import type { OverlayOptions, OverlayScene } from './types';

const WIDTH_PX = 1600;
const HEIGHT_PX = 1200;
const HFOV_DEG = 60;
const TAN_HALF_V = Math.tan((HFOV_DEG / 2) * (Math.PI / 180)) * (HEIGHT_PX / WIDTH_PX);

const POSE: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: HFOV_DEG,
  vFovDeg: (2 * Math.atan(TAN_HALF_V) * 180) / Math.PI,
};

function peak(overrides: Partial<VisiblePeak> & Pick<VisiblePeak, 'id' | 'name'>): VisiblePeak {
  return {
    lat: 46,
    lon: 7.5,
    elevationM: 4478,
    elevationSource: 'osm',
    bearingDeg: 105,
    altitudeDeg: 3,
    distanceKm: 12.3,
    occludingAltitudeDeg: 1,
    clearanceDeg: 2,
    ...overrides,
  };
}

function flatHorizon(altitudeDeg: number): HorizonProfile {
  const points: HorizonPoint[] = [];
  for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 45) {
    points.push({ bearingDeg, altitudeDeg, distanceKm: 20, elevationM: 2000 });
  }
  return points;
}

function scene(overrides: Partial<OverlayScene> = {}): OverlayScene {
  return {
    widthPx: WIDTH_PX,
    heightPx: HEIGHT_PX,
    pose: POSE,
    horizon: flatHorizon(0),
    peaks: [peak({ id: 'node/1', name: 'Matterhorn' })],
    ...overrides,
  };
}

const PINNED: OverlayOptions = {
  nameFontPx: 20,
  detailFontPx: 14,
  labelPaddingPx: 4,
  labelGapPx: 3,
  basePoleLengthPx: 60,
  frameMarginPx: 10,
  maxStackLevels: 6,
  summitDotRadiusPx: 5,
  horizonSampleCount: 12,
};

/**
 * A deliberately strict, independent well-formedness scan.
 *
 * Not a full XML parser — it checks the two things this builder could plausibly
 * get wrong: an unbalanced element, and an ampersand that is not part of a
 * legal entity reference. Both produce a document a browser refuses to parse,
 * and an SVG loaded through `<img src="data:image/svg+xml,…">` fails *silently*
 * when that happens, so nothing downstream would report it.
 */
function xmlProblems(document: string): string[] {
  const problems: string[] = [];

  const badEntity = document.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  if (badEntity !== null) {
    problems.push(`bare ampersand near: ${document.slice(badEntity.index ?? 0, (badEntity.index ?? 0) + 30)}`);
  }

  const stack: string[] = [];
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  let match = tagPattern.exec(document);
  while (match !== null) {
    const [, closing, name, selfClosing] = match;
    if (name === undefined) break;
    if (closing === '/') {
      if (stack.pop() !== name) problems.push(`unbalanced </${name}>`);
    } else if (selfClosing !== '/') {
      stack.push(name);
    }
    match = tagPattern.exec(document);
  }
  if (stack.length > 0) problems.push(`unclosed: ${stack.join(', ')}`);

  return problems;
}

describe('buildOverlaySvg — document shape', () => {
  it('opens a namespaced svg element sized to the photograph', () => {
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="1600"');
    expect(svg).toContain('height="1200"');
    expect(svg).toContain('viewBox="0 0 1600 1200"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('is well-formed', () => {
    expect(xmlProblems(buildOverlaySvg(scene(), PINNED))).toEqual([]);
  });

  it('draws the horizon, a pole, a summit dot and two label lines per peak', () => {
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<line');
    expect(svg).toContain('<circle');
    expect(svg.match(/<text/g)).toHaveLength(2);
    expect(svg).toContain('>Matterhorn</text>');
    expect(svg).toContain('>4478 m · 12.3 km</text>');
  });

  it('paints the halo stroke behind the glyphs, not over them', () => {
    // Without paint-order the outline is drawn on top and eats into every
    // letter, which is worse than no halo at all.
    expect(buildOverlaySvg(scene(), PINNED)).toContain('paint-order="stroke"');
  });

  it('draws each mark twice — dark halo first, then the bright mark', () => {
    const svg = buildOverlaySvg(scene(), PINNED);
    const haloIndex = svg.indexOf('class="mf-halo"');
    const horizonIndex = svg.indexOf('class="mf-horizon"');
    const poleIndex = svg.indexOf('class="mf-poles"');
    expect(haloIndex).toBeGreaterThanOrEqual(0);
    expect(haloIndex).toBeLessThan(horizonIndex);
    expect(haloIndex).toBeLessThan(poleIndex);
  });

  it('draws labels last, so nothing is painted across them', () => {
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg.indexOf('class="mf-labels"')).toBeGreaterThan(svg.indexOf('class="mf-summits"'));
  });
});

describe('buildOverlaySvg — geometry reaches the document intact', () => {
  it('writes the hand-computed flag position into the summit dot', () => {
    // From the derivation in layout.test.ts: x = 1600·(√3 − 1) = 1171.28129,
    // y = 524.81995, both rounded to the two decimals the serialiser keeps.
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg).toContain('<circle cx="1171.28" cy="524.82" r="5"/>');
  });

  it('anchors the label centre on the same x as the flag', () => {
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('<text x="1171.28"');
  });

  it('draws the pole from the summit straight up by the base pole length', () => {
    // 524.81995 − 60 = 464.81995 → 464.82.
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg).toContain('x1="1171.28" y1="524.82" x2="1171.28" y2="464.82"');
  });

  it('draws a flat skyline as a level line across the frame', () => {
    // α = 0 everywhere → y = 0.5 exactly at every bearing → 600 px, clipped to
    // x ∈ [0, 1600].
    const svg = buildOverlaySvg(scene(), PINNED);
    expect(svg).toContain('points="0,600');
    expect(svg).toContain('1600,600"');
  });

  it('omits peaks that fall outside the frame', () => {
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Matterhorn' }),
          peak({ id: 'node/2', name: 'Offscreen', bearingDeg: 130 }),
          peak({ id: 'node/3', name: 'Behind', bearingDeg: 270 }),
        ],
      }),
      PINNED,
    );
    expect(svg).toContain('Matterhorn');
    expect(svg).not.toContain('Offscreen');
    expect(svg).not.toContain('Behind');
    expect(svg.match(/<circle/g)).toHaveLength(1);
  });

  it('emits nothing but the frame for an empty scene', () => {
    const svg = buildOverlaySvg(scene({ peaks: [], horizon: [] }), PINNED);
    expect(svg).not.toContain('<circle');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<polyline');
    expect(xmlProblems(svg)).toEqual([]);
  });
});

describe('buildOverlaySvg — XML escaping', () => {
  const HOSTILE = 'Dent d\'Hérens & "Tête" <blanche>';

  it('escapes every special character in a peak name', () => {
    const svg = buildOverlaySvg(
      scene({ peaks: [peak({ id: 'node/1', name: HOSTILE })] }),
      PINNED,
    );
    expect(svg).toContain(
      '>Dent d&apos;Hérens &amp; &quot;Tête&quot; &lt;blanche&gt;</text>',
    );
  });

  it('leaves the document well-formed despite the name', () => {
    const svg = buildOverlaySvg(
      scene({ peaks: [peak({ id: 'node/1', name: HOSTILE })] }),
      PINNED,
    );
    expect(xmlProblems(svg)).toEqual([]);
  });

  it('does not let a name close an element early', () => {
    // The classic injection: a name that terminates <text> and opens a script.
    const svg = buildOverlaySvg(
      scene({
        peaks: [peak({ id: 'node/1', name: '</text><script>alert(1)</script>' })],
      }),
      PINNED,
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(xmlProblems(svg)).toEqual([]);
  });

  it('escapes a name used in a clustered layout too, not just a lone peak', () => {
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          peak({ id: 'node/1', name: "Dent d'Hérens", bearingDeg: 105.0 }),
          peak({ id: 'node/2', name: 'Tosa & Brenta', bearingDeg: 105.1 }),
        ],
      }),
      PINNED,
    );
    expect(svg).toContain('>Dent d&apos;Hérens</text>');
    expect(svg).toContain('>Tosa &amp; Brenta</text>');
    expect(xmlProblems(svg)).toEqual([]);
  });
});

describe('buildOverlaySvg — determinism', () => {
  it('produces byte-identical output for the same scene', () => {
    expect(buildOverlaySvg(scene(), PINNED)).toBe(buildOverlaySvg(scene(), PINNED));
  });

  it('is unaffected by the order the peaks arrive in', () => {
    const peaks = [
      peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0 }),
      peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.1 }),
      peak({ id: 'node/3', name: 'Charlie', bearingDeg: 105.2 }),
    ];
    expect(buildOverlaySvg(scene({ peaks: [...peaks].reverse() }), PINNED)).toBe(
      buildOverlaySvg(scene({ peaks }), PINNED),
    );
  });

  it('serialises a pre-computed layout to the same document', () => {
    const layout = layoutOverlay(scene(), PINNED);
    expect(buildOverlaySvgFromLayout(layout)).toBe(buildOverlaySvg(scene(), PINNED));
  });

  it('accepts an alternative theme without changing the geometry', () => {
    const restyled = buildOverlaySvgFromLayout(layoutOverlay(scene(), PINNED), {
      ...DEFAULT_THEME,
      horizonColor: '#00ff00',
    });
    expect(restyled).toContain('#00ff00');
    expect(restyled).toContain('<circle cx="1171.28" cy="524.82" r="5"/>');
  });
});

describe('buildOverlaySvg — snapshot', () => {
  it('matches the recorded document for a three-peak scene', () => {
    // Overall-shape guard only. The load-bearing assertions are the
    // hand-computed coordinates above; this catches unintended churn in
    // everything around them.
    const svg = buildOverlaySvg(
      scene({
        horizon: flatHorizon(1.5),
        peaks: [
          peak({ id: 'node/1', name: "Dent d'Hérens", bearingDeg: 95, altitudeDeg: 2.4 }),
          peak({ id: 'node/2', name: 'Matterhorn', bearingDeg: 105, altitudeDeg: 3 }),
          peak({ id: 'node/3', name: 'Pollux', bearingDeg: 105.4, altitudeDeg: 2.7 }),
        ],
      }),
      PINNED,
    );
    expect(svg).toMatchSnapshot();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D8 — how an obscured peak is drawn
 * ══════════════════════════════════════════════════════════════════════════ */

describe('buildOverlaySvg — obscured peaks (D8)', () => {
  const obscuredScene = scene({
    peaks: [{ ...peak({ id: 'node/1', name: 'Cow Hill' }), visibility: 'self-occluded' }],
  });

  it('leaves a scene with nothing obscured byte-for-byte unchanged', () => {
    // The whole feature has to be inert on ordinary scenes, or every existing
    // pixel assertion in this suite silently changes meaning.
    const withoutField = buildOverlaySvg(scene(), PINNED);
    const withExplicitVisible = buildOverlaySvg(
      scene({ peaks: [{ ...peak({ id: 'node/1', name: 'Matterhorn' }), visibility: 'visible' }] }),
      PINNED,
    );
    expect(withExplicitVisible).toBe(withoutField);
  });

  it('de-emphasises the obscured mark without weakening its halo', () => {
    const svg = buildOverlaySvg(obscuredScene, PINNED);

    // The bright marks fade...
    expect(svg).toContain(`class="mf-poles mf-poles--obscured"`);
    expect(svg).toContain(`stroke-dasharray=`);
    expect(svg).toContain(`fill-opacity="${DEFAULT_THEME.obscuredOpacity}"`);

    // ...but the dark halo pass, which is what buys legibility over bright
    // haze, is emitted at exactly the same opacity as for a solid label. A
    // greyed label that becomes unreadable over sky is not a greyed label, it
    // is a lost one.
    const haloOpacities = [...svg.matchAll(/stroke-opacity="([\d.]+)"/g)].map(
      (match) => match[1],
    );
    expect(haloOpacities).toContain(String(DEFAULT_THEME.haloOpacity));
    expect(svg).toContain(`stroke-opacity="${DEFAULT_THEME.haloOpacity + 0.2}"`);
  });

  it('marks it in three ways that survive without colour: dash, ring, and words', () => {
    const svg = buildOverlaySvg(obscuredScene, PINNED);

    // 1. the pole is dashed rather than solid
    expect(svg).toMatch(/class="mf-poles mf-poles--obscured"[\s\S]*?stroke-dasharray/);
    // 2. the summit marker is a ring, not a filled dot
    expect(svg).toMatch(/class="mf-summits mf-summits--obscured"[\s\S]*?fill="none"/);
    // 3. the label says so
    expect(svg).toContain('summit obscured');
  });

  it('refuses to draw a foreground-occluded peak at all', () => {
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          { ...peak({ id: 'node/2', name: 'Ben Nevis' }), visibility: 'foreground-occluded' },
        ],
      }),
      PINNED,
    );
    expect(svg).not.toContain('Ben Nevis');
    expect(svg).not.toContain('<circle');
  });
});

/**
 * ## Summits the frame had no room to name
 *
 * The layout may withhold a label when the frame is full (`layout.ts` rule 7).
 * The permission is only defensible if the omission is visible in the delivered
 * document, so this block asserts the two marks that make it visible: the dot
 * that stays behind, and the line in the corner that counts them.
 *
 * Positions are the same closed form used throughout this file: a peak at
 * Δ = 15°, α = 3° projects to x = 1600·(√3 − 1) = 1171.28 px and y = 524.82 px,
 * and with `summitDotRadiusPx: 5` and the theme's `crowdedDotScale` of 0.7 the
 * unnamed dot has radius 3.5 px. The indicator sits one frame margin in from
 * the bottom-right corner: (1600 − 10, 1200 − 10).
 */
describe('buildOverlaySvg — crowded-out summits', () => {
  const CROWDED = { ...PINNED, maxLabels: 1 };

  function crowdedScene(): OverlayScene {
    return scene({
      peaks: [
        // Rides higher, so it wins the single label.
        peak({ id: 'node/1', name: 'Tall', bearingDeg: 80, altitudeDeg: 6 }),
        peak({ id: 'node/2', name: 'Short', bearingDeg: 105, altitudeDeg: 3 }),
      ],
    });
  }

  it('leaves a smaller dot where the name would not fit', () => {
    const svg = buildOverlaySvg(crowdedScene(), CROWDED);
    expect(svg).toContain('<circle cx="1171.28" cy="524.82" r="3.5"/>');
  });

  it('does not draw the withheld name, or a pole to it', () => {
    const svg = buildOverlaySvg(crowdedScene(), CROWDED);
    expect(svg).toContain('>Tall<');
    expect(svg).not.toContain('>Short<');
    // One pole, for the one labelled marker.
    expect(svg.match(/<line /g)).toHaveLength(2 * 1);
  });

  it('states in the document how many summits went unnamed', () => {
    const svg = buildOverlaySvg(crowdedScene(), CROWDED);
    expect(svg).toContain('+1 more named summit in this frame');
    expect(svg).toContain('too crowded to label');
    expect(svg).toContain('x="1590" y="1190"');
    expect(svg).toContain('text-anchor="end"');
  });

  it('pluralises the count', () => {
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Tall', bearingDeg: 80, altitudeDeg: 6 }),
          peak({ id: 'node/2', name: 'Short', bearingDeg: 105, altitudeDeg: 3 }),
          peak({ id: 'node/3', name: 'Lower', bearingDeg: 100, altitudeDeg: 2 }),
        ],
      }),
      CROWDED,
    );
    expect(svg).toContain('+2 more named summits in this frame');
  });

  it('says nothing at all when every summit got its name', () => {
    const svg = buildOverlaySvg(crowdedScene(), PINNED);
    expect(svg).not.toContain('too crowded');
    expect(svg).not.toContain('mf-crowding');
  });

  it('keeps a greyed summit greyed when it loses its label (D8)', () => {
    // A self-occluded summit that is crowded out keeps the hollow-ring shape,
    // so the one cue that survives without colour survives without a label too.
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Tall', bearingDeg: 80, altitudeDeg: 6 }),
          {
            ...peak({ id: 'node/2', name: 'Short', bearingDeg: 105, altitudeDeg: 3 }),
            visibility: 'self-occluded' as const,
          },
        ],
      }),
      CROWDED,
    );
    const obscuredGroup = svg.slice(svg.indexOf('mf-summits--obscured'));
    expect(obscuredGroup).toContain('<circle cx="1171.28" cy="524.82" r="3.5"/>');
    const solidGroup = svg.slice(
      svg.indexOf('class="mf-summits"'),
      svg.indexOf('mf-summits--obscured'),
    );
    expect(solidGroup).not.toContain('cx="1171.28"');
  });

  it('never marks a foreground-occluded summit, crowded or not (D8)', () => {
    const svg = buildOverlaySvg(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Tall', bearingDeg: 80, altitudeDeg: 6 }),
          {
            ...peak({ id: 'node/2', name: 'Ben Nevis', bearingDeg: 105, altitudeDeg: 9 }),
            visibility: 'foreground-occluded' as const,
          },
        ],
      }),
      CROWDED,
    );
    expect(svg).not.toContain('Ben Nevis');
    expect(svg).not.toContain('cx="1171.28"');
    // Refused, not crowded out — so the crowding line must not claim otherwise.
    expect(svg).not.toContain('too crowded');
  });

  it('stays well-formed with the crowding line in it', () => {
    expect(xmlProblems(buildOverlaySvg(crowdedScene(), CROWDED))).toEqual([]);
  });
});
