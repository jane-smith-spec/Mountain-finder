import { describe, expect, it } from 'vitest';

import { crowdingIndicatorText, crowdingNote } from './crowding';
import type { OverlayLayout, OverlayPeak, PointPx, UnlabelledSummit } from './types';

function summit(name: string, altitudeDeg: number): UnlabelledSummit {
  const peak: OverlayPeak = {
    id: `node/${name}`,
    name,
    lat: 46,
    lon: 7.5,
    elevationM: 4000,
    elevationSource: 'osm',
    bearingDeg: 100,
    altitudeDeg,
    distanceKm: 10,
    occludingAltitudeDeg: 0,
    clearanceDeg: altitudeDeg,
  };
  const summitPx: PointPx = { xPx: 0, yPx: 0 };
  return { peak, summitPx, obscured: false };
}

/** Only the fields the note builder reads; the rest of a layout is irrelevant. */
function layout(markerCount: number, dropped: readonly UnlabelledSummit[]): OverlayLayout {
  return {
    widthPx: 1600,
    heightPx: 1200,
    horizonPolylinesPx: [],
    markers: Array.from({ length: markerCount }, () => undefined) as unknown as OverlayLayout['markers'],
    offFramePeaks: [],
    foregroundOccludedPeaks: [],
    crowdedOutSummits: dropped,
    options: {} as unknown as OverlayLayout['options'],
  };
}

describe('crowdingIndicatorText', () => {
  it('says nothing when the frame held every name', () => {
    expect(crowdingIndicatorText(0)).toBeUndefined();
    expect(crowdingIndicatorText(-1)).toBeUndefined();
  });

  it('counts one summit in the singular', () => {
    expect(crowdingIndicatorText(1)).toBe(
      '+1 more named summit in this frame — marked, too crowded to label',
    );
  });

  it('counts several in the plural', () => {
    expect(crowdingIndicatorText(18)).toContain('+18 more named summits in this frame');
  });
});

describe('crowdingNote', () => {
  it('says nothing when the frame held every name', () => {
    expect(crowdingNote(layout(5, []))).toBeUndefined();
  });

  it('reports the count against the total that were in frame', () => {
    const note = crowdingNote(layout(24, [summit('A', 5), summit('B', 4)]));
    // 24 labelled + 2 withheld = 26 named summits inside this frame.
    expect(note).toContain('2 of the 26 named summits in this frame');
  });

  it('names the summits it withheld, in the order they lost', () => {
    const note = crowdingNote(
      layout(1, [summit('Bietschhorn', 5), summit('Wiwannihorn', 4), summit('Jegihorn', 3)]),
    );
    expect(note).toContain('Bietschhorn, Wiwannihorn, Jegihorn');
  });

  it('truncates a long list rather than printing forty names', () => {
    const dropped = Array.from({ length: 9 }, (_, index) =>
      summit(`P${String(index)}`, 9 - index),
    );
    const note = crowdingNote(layout(20, dropped));
    expect(note).toContain('P0, P1, P2, P3 and 5 more');
  });

  it('reads correctly for a single withheld summit', () => {
    const note = crowdingNote(layout(3, [summit('Solo', 2)]));
    expect(note).toContain('1 of the 4 named summits in this frame is marked');
    expect(note).toContain('room for its name');
  });
});
