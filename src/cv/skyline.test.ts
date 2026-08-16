/**
 * Skyline extraction, against images whose true boundary row is written into
 * the image by construction.
 *
 * The expectations are the rows the test itself drew, plus the four confidence
 * factors reasoned about from what each image contains — never numbers copied
 * out of a run. Where a tolerance appears it is stated in pixels and justified.
 */

import { describe, expect, it } from 'vitest';

import { extractSkyline, READABLE_FLOOR } from './skyline.js';
import type { RgbaImage } from './types.js';

/** Build an image from a per-pixel colour function. */
function imageFrom(
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly [number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

const SKY: readonly [number, number, number] = [190, 210, 235];
const ROCK: readonly [number, number, number] = [55, 48, 42];

describe('extractSkyline on a clean two-tone silhouette', () => {
  const WIDTH = 256;
  const HEIGHT = 200;
  /** Truth: a ridge that rises to a peak at x = 96 and falls away. */
  const trueRow = (x: number): number => Math.round(120 - 60 * Math.exp(-(((x - 96) / 40) ** 2)));

  const image = imageFrom(WIDTH, HEIGHT, (x, y) => (y < trueRow(x) ? SKY : ROCK));
  const skyline = extractSkyline(image, { columnCount: WIDTH });

  it('finds every column', () => {
    expect(skyline.coverage01).toBe(1);
    expect(skyline.columns).toHaveLength(WIDTH);
  });

  it('puts the boundary on the drawn row, within one pixel', () => {
    // The extractor reports the centre of the first terrain row, so the exact
    // answer is (trueRow(x) + 0.5)/HEIGHT. One pixel of slack covers the 3-row
    // pre-blur; nothing else in this image can move it.
    for (let column = 0; column < WIDTH; column += 1) {
      const found = skyline.columns[column]?.rowNorm;
      expect(found).toBeDefined();
      if (found === undefined) continue;
      expect(Math.abs(found * HEIGHT - (trueRow(column) + 0.5))).toBeLessThanOrEqual(1);
    }
  });

  it('reports high confidence, because every factor is at its best here', () => {
    // Noiseless two-tone: contrast ≈ 0.47 (saturating), within-segment scatter
    // 0, the edge is one row wide, and neighbours agree.
    for (const column of skyline.columns) expect(column.confidence01).toBeGreaterThan(0.9);
    expect(skyline.meanConfidence01).toBeGreaterThan(0.9);
  });

  it('measures relief that matches the drawn ridge height', () => {
    // The drawn ridge spans 60 of 200 rows, so its standard deviation is a
    // sizeable fraction of 0.3 — certainly far above the 0.002 a flat line gives.
    expect(skyline.reliefNorm).toBeGreaterThan(0.05);
  });
});

describe('extractSkyline refuses where there is no evidence', () => {
  it('reports nothing at all for a uniform frame', () => {
    const image = imageFrom(64, 64, () => [128, 128, 128]);
    const skyline = extractSkyline(image, { columnCount: 64 });
    expect(skyline.coverage01).toBe(0);
    expect(skyline.meanConfidence01).toBe(0);
    for (const column of skyline.columns) {
      expect(column.rowNorm).toBeUndefined();
      expect(column.confidence01).toBe(0);
    }
  });

  it('reports nothing for an inverted frame (dark above, bright below)', () => {
    // There is no ordered split with the bright segment on top, so `fitStep`
    // has nothing to return. A skyline is sky-above-terrain by definition.
    const image = imageFrom(64, 64, (_x, y) => (y < 32 ? ROCK : SKY));
    const skyline = extractSkyline(image, { columnCount: 64 });
    expect(skyline.coverage01).toBe(0);
  });

  it('refuses a smooth top-to-bottom gradient — big contrast, but no edge', () => {
    // This is the case `contrast` and `snr` both wave through: splitting a
    // linear ramp in half gives a contrast of half the range and a healthy
    // SNR. Only the local-edge factor can tell that no horizon is present.
    const image = imageFrom(64, 128, (_x, y) => {
      const value = Math.round(230 - (200 * y) / 127);
      return [value, value, value];
    });
    const skyline = extractSkyline(image, { columnCount: 64 });
    for (const column of skyline.columns) {
      expect(column.contrast).toBeGreaterThan(0.1); // the ramp really is high-contrast
      expect(column.edge01).toBeLessThan(0.15); // …and really has no edge
      expect(column.rowNorm).toBeUndefined();
    }
    expect(skyline.coverage01).toBe(0);
  });

  it('refuses pure noise, where any split is as good as any other', () => {
    // Deterministic pseudo-noise — no Math.random anywhere in this module.
    let state = 12345;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    const image = imageFrom(64, 96, () => {
      const value = Math.round(90 + 70 * next());
      return [value, value, value];
    });
    const skyline = extractSkyline(image, { columnCount: 64 });
    expect(skyline.coverage01).toBeLessThan(0.05);
  });
});

describe('the neighbour-agreement factor', () => {
  it('demotes a single column that locked onto a cloud far above the ridge', () => {
    const WIDTH = 128;
    const HEIGHT = 200;
    const ROGUE = 64;
    const RIDGE_ROW = 150;
    const CLOUD_ROW = 40;
    // Every column is sky over rock at row 150. In the rogue column the sky
    // above row 40 is dark, so the strongest step there is the cloud edge —
    // 110 rows (55 % of the frame) from where its neighbours put the skyline.
    const image = imageFrom(WIDTH, HEIGHT, (x, y) => {
      if (y >= RIDGE_ROW) return ROCK;
      if (x === ROGUE && y < CLOUD_ROW) return [70, 78, 95];
      return SKY;
    });
    const skyline = extractSkyline(image, { columnCount: WIDTH });

    const rogue = skyline.columns[ROGUE];
    const neighbour = skyline.columns[ROGUE + 8];
    expect(rogue).toBeDefined();
    expect(neighbour).toBeDefined();
    if (rogue === undefined || neighbour === undefined) return;

    // The neighbour is on the real ridge with full agreement.
    expect(neighbour.rowNorm).toBeDefined();
    expect(neighbour.agreement01).toBeGreaterThan(0.9);

    // The rogue column disagrees with its neighbours by 0.55 of the frame,
    // which at a 0.12 tolerance is 1/(1+(0.55/0.12)²) ≈ 0.045 — an order of
    // magnitude of demotion, and enough to make it not worth listening to.
    expect(rogue.agreement01).toBeLessThan(0.06);
    expect(rogue.confidence01).toBeLessThan(0.1);
  });

  it('does NOT demote a genuinely sharp summit, which also disagrees locally', () => {
    // The guard has to survive real terrain: a spire moves the skyline fast.
    // Over ±16 columns of a 256-wide frame this ridge climbs 45 rows of 200 —
    // 22 % of the frame — and must still be believed.
    const WIDTH = 256;
    const HEIGHT = 200;
    const trueRow = (x: number): number => Math.round(150 - 90 * Math.exp(-(((x - 128) / 18) ** 2)));
    const image = imageFrom(WIDTH, HEIGHT, (x, y) => (y < trueRow(x) ? SKY : ROCK));
    const skyline = extractSkyline(image, { columnCount: WIDTH });
    const apex = skyline.columns[128];
    expect(apex).toBeDefined();
    if (apex === undefined) return;
    expect(apex.rowNorm).toBeDefined();
    expect(apex.confidence01).toBeGreaterThan(READABLE_FLOOR);
    expect(skyline.coverage01).toBe(1);
  });
});

describe('extractSkyline under a hostile but readable sky', () => {
  it('survives a bright haze band sitting exactly at the skyline', () => {
    // The haze band is the classic trap: the brightest sky and the brightest
    // rock meet at the boundary, so the contrast there is at its weakest.
    const WIDTH = 128;
    const HEIGHT = 160;
    const RIDGE = 100;
    const image = imageFrom(WIDTH, HEIGHT, (_x, y) => {
      if (y >= RIDGE) {
        const t = (y - RIDGE) / (HEIGHT - RIDGE);
        const value = Math.round(90 - 75 * t);
        return [value, value - 6, value - 12];
      }
      const t = y / RIDGE;
      const value = Math.round(60 + 175 * t);
      return [value, value + 10, value + 25];
    });
    const skyline = extractSkyline(image, { columnCount: WIDTH });
    expect(skyline.coverage01).toBe(1);
    for (const column of skyline.columns) {
      expect(column.rowNorm).toBeDefined();
      if (column.rowNorm === undefined) continue;
      expect(Math.abs(column.rowNorm * HEIGHT - (RIDGE + 0.5))).toBeLessThanOrEqual(1.5);
    }
  });
});
