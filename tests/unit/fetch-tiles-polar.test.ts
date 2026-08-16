/**
 * `scripts/fetch-tiles.ts` — which tiles a `--around/--radius-km` request asks
 * for. Wave 3 finding 1's reproduction, pinned.
 *
 * The script is an acquisition tool, so it is the one place a wrong tile LIST
 * costs a real download and, worse, a silent non-download: it reports what it
 * fetched, never what it should have fetched and did not. `parseArgs` is pure
 * and the module guards its own `main`, so importing it here fetches nothing.
 *
 * WHERE THE EXPECTATIONS COME FROM. Arithmetic on the documented rule, not from
 * the code: 200 km / 111.32 km-per-degree = 1.7967° of latitude, so the box
 * around 89 N, 10 E runs 87.203 … 90 N. Its northern edge is the pole, where a
 * degree of longitude is zero kilometres wide, so the circle takes in every
 * meridian — including the one the observer is standing on.
 */

import { describe, expect, it } from 'vitest';

import { boundsAround, parseArgs } from '../../scripts/fetch-tiles.js';

describe('fetch-tiles --around near the pole (Wave 3 finding 1)', () => {
  const options = parseArgs(['--around', '89,10', '--radius-km', '200', '--dry-run']);

  it('asks for the tile the observer is standing on', () => {
    // 89 N, 10 E is in N89E010 by the floor rule. A polar request that does not
    // name it has answered a different question entirely.
    expect(options.names).toContain('N89E010');
  });

  it('does not answer a polar request with a single far-away meridian', () => {
    // The demonstrated failure: three tiles on W170, 180° away, reported as a
    // complete answer. W170 is 10 − 180, the west edge of the capped box.
    const w170 = options.names.filter((name) => name.endsWith('W170'));
    expect(options.names.length).toBeGreaterThan(w170.length);
  });

  it('covers every meridian in each latitude band the circle reaches', () => {
    // Bands N87, N88, N89 (the pole belongs to N89), 360 meridians each.
    const bands = new Set(options.names.map((name) => name.slice(0, 3)));
    expect([...bands].sort()).toEqual(['N87', 'N88', 'N89']);
    expect(options.names).toHaveLength(3 * 360);
    expect(new Set(options.names).size).toBe(options.names.length);
  });

  it('leaves an ordinary alpine request untouched', () => {
    // 20 km around the Matterhorn: dLat = 0.1796°, dLon = 0.1796/cos(46.156°) =
    // 0.2593°, so the box is 45.797…46.156 N, 7.399…7.918 E — two tiles.
    const alpine = parseArgs(['--around', '45.976,7.659', '--radius-km', '20']);
    expect(alpine.names).toEqual(['N45E007', 'N46E007']);
  });

  it('states a box that spans a whole turn of longitude at the pole', () => {
    const box = boundsAround({ lat: 89, lon: 10 }, 200);
    expect(box.east - box.west).toBeCloseTo(360, 9);
    expect(box.north).toBe(90);
    expect(box.south).toBeCloseTo(89 - 200 / 111.32, 9);
  });
});
