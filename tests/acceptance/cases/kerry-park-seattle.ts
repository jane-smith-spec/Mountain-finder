/**
 * GROUND-TRUTH CASE — KERRY PARK, SEATTLE, WASHINGTON
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the occlusion case with a comfortable margin, and it is the one I
 * would keep if I could keep only one.
 *
 * Kerry Park is a viewpoint on the SOUTH SLOPE of Queen Anne Hill. It looks
 * south over downtown Seattle to Mount Rainier. Mount Baker — a 3 286 m
 * stratovolcano, 134 km to the NORTH-NORTH-EAST — is not visible from it,
 * because the rest of Queen Anne Hill is in the way. Nothing exotic is needed
 * to establish this: the blocker is 500-ish metres away and tens of metres
 * above the camera, so it wins by degrees, not by hundredths.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INDEPENDENT GEOMETRY CHECK (R = 6 371 008.8 m, k = 0.13, R_eff = R/(1−k))
 * ───────────────────────────────────────────────────────────────────────────
 * Eye at 113 + 1.6 = 114.6 m. Sea-horizon dip = −0.3205°.
 *
 *   target          distance   bearing    altitudeDeg
 *   Mount Rainier     97.5 km   152.1°      +2.1314°
 *   Mount Baker      133.8 km    17.4°      +0.8342°
 *   Mount Hood       255.9 km   168.3°      −0.2592°
 *
 * ── Why Rainier is visible ──────────────────────────────────────────────────
 *   c = 97 500² / (2 R_eff) = 9.5063e9 / 1.4646e7 = 649.0 m
 *   tan α = (4392 − 114.6 − 649.0) / 97 500 = 3628.4 / 97 500 = 0.037214
 *   α = +2.132°
 * To hide that, terrain between here and Rainier would have to reach
 * 114.6 + 0.037214·d + d²/(2 R_eff) above sea level; at d = 40 km that is
 * 1 712 m. The Cascade foothills on that line do not come close, and Rainier
 * from Kerry Park is one of the most photographed sightlines in the city.
 *
 * ── Why Baker is NOT visible ────────────────────────────────────────────────
 * Baker subtends +0.8342°. To block it, terrain at ground distance x north of
 * the camera needs only
 *
 *     Δh ≥ x · tan(0.8342°) = 0.014561 · x
 *
 *     x = 300 m  →  Δh ≥  4.4 m
 *     x = 500 m  →  Δh ≥  7.3 m
 *     x = 800 m  →  Δh ≥ 11.6 m
 *
 * Queen Anne Hill crests at about 456 ft ≈ 139 m within roughly half a
 * kilometre north of the park, i.e. some 24 m above the camera — three times
 * what is required, and the requirement is only ~7 m. For the block to fail,
 * Kerry Park would have to be within about 7 m of the hilltop, which
 * contradicts the one thing every source agrees on: it is a *south slope*
 * viewpoint whose entire fame rests on looking downhill over the city.
 *
 * So this expectation survives the weakest number in the file (see caveats on
 * the observer elevation) by a wide margin. That is the property I want in a
 * must-not-see claim.
 *
 * ── An honest borderline, recorded but not asserted ─────────────────────────
 * Mount Hood sits at −0.2592° against a −0.3205° sea horizon: above it by
 * 0.061°. That margin is smaller than the swing between k = 0.13 and a hot- or
 * cold-day refraction coefficient, so the true answer depends on the weather.
 * It goes in `disputed`.
 */

import type { GroundTruthCase } from './case-types';

export const kerryParkSeattleCase: GroundTruthCase = {
  id: 'kerry-park-seattle',
  title: 'Kerry Park, Queen Anne, Seattle, Washington, USA',

  observer: {
    lat: 47.62944,
    lon: -122.36,
    // WEAKEST NUMBER IN THIS FILE. No source gives Kerry Park's own elevation;
    // the widely repeated "456 ft" is Queen Anne Hill's SUMMIT, and the park is
    // below it on the south slope. 113 m is a working figure with an honest
    // +-15 m band. Everything asserted here is insensitive to it (see header),
    // and a real run should take the ground height from the DEM anyway.
    groundElevationM: 113,
    eyeHeightM: 1.6,
    groundElevationUncertaintyM: 15,
    positionSourceId: 'wp-kerry-park',
    elevationSourceId: 'estimate-kerry-park-elevation',
  },

  view: {
    bearingDeg: 152,
    note:
      'South-south-east over downtown Seattle to Mount Rainier: the framing of ' +
      'essentially every photograph ever taken here.',
  },

  mustBeVisible: [
    {
      name: 'Mount Rainier',
      location: { lat: 46.852886, lon: -121.760374 },
      elevationM: 4392,
      positionSourceId: 'wp-mount-rainier',
      evidence: ['published-claim', 'multiple-independent-sources', 'own-geometry', 'photographic'],
      confidence: 'high',
      rationale:
        'Named as the view from this park by Wikipedia, the City of Seattle ' +
        'parks page and every travel guide that mentions it. 97.5 km at bearing ' +
        '152.1 deg, altitude +2.13 deg; blocking it would need 1,712 m of ' +
        'terrain at 40 km, which does not exist on that line.',
    },
  ],

  mustNotBeVisible: [
    {
      name: 'Mount Baker',
      location: { lat: 48.7767, lon: -121.8144 },
      elevationM: 3286,
      positionSourceId: 'wp-mount-baker',
      evidence: ['own-geometry', 'published-claim'],
      confidence: 'high',
      rationale:
        'Baker lies at bearing 17.4 deg and subtends +0.834 deg, so it is well ' +
        'clear of the curvature horizon and only terrain can hide it. The ' +
        'terrain that does is the rest of Queen Anne Hill: the park sits on the ' +
        'hill\'s south slope (Wikipedia) and the crest behind it is roughly 24 m ' +
        'above the camera within about 500 m, where just 7.3 m would suffice. ' +
        'Consistently, no source describing the Kerry Park view mentions Baker, ' +
        'while every north-facing Seattle viewpoint does. This is the case that ' +
        'catches a pipeline which only tests peaks against the far horizon and ' +
        'never samples terrain in the first few hundred metres.',
    },
  ],

  disputed: [
    {
      name: 'Mount Hood',
      location: { lat: 45.373611, lon: -121.695833 },
      elevationM: 3429,
      positionSourceId: 'wp-mount-hood',
      evidence: ['own-geometry'],
      conflict:
        'Geometry puts Hood at 255.9 km, bearing 168.3 deg, altitude -0.2592 deg ' +
        'against a -0.3205 deg sea horizon: it clears by 0.061 deg. That is ' +
        'inside the swing produced by ordinary variation in the refraction ' +
        'coefficient, so whether Hood is visible from Kerry Park genuinely ' +
        'depends on the day. Recorded because it is a useful sensitivity probe ' +
        '(if the pipeline reports Hood, ask what k it used), never asserted.',
    },
  ],

  photos: [
    {
      url: 'https://commons.wikimedia.org/wiki/Category:Views_of_Mount_Rainier_from_Seattle',
      licence: 'per-file; not verified in this environment',
      attribution: 'various contributors, Wikimedia Commons',
      note:
        'Category page. Individual candidates surfaced by search include ' +
        'File:Seattle_Kerry_Park_Skyline.jpg and ' +
        'File:Space_Needle_and_skyline_from_Kerry_Park,_2000.jpg, but their ' +
        'licences and authors could not be read here (commons.wikimedia.org is ' +
        'blocked at the egress proxy), so none is claimed as openly licensed. ' +
        'Open the file page before using any of them.',
    },
  ],

  sources: [
    {
      id: 'wp-kerry-park',
      title:
        'Kerry Park — Wikipedia (47.62944 N, 122.36000 W; "south slope of Queen ' +
        'Anne Hill"; Mount Rainier named in the view)',
      url: 'https://en.wikipedia.org/wiki/Kerry_Park',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'seattle-gov-kerry-park',
      title: 'Kerry Park (Franklin Place) — Seattle Parks and Recreation',
      url: 'https://www.seattle.gov/parks/parks/kerry-park',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'estimate-kerry-park-elevation',
      title:
        'Kerry Park ground elevation — NO PRIMARY SOURCE FOUND. 113 m is an ' +
        'estimate below the 456 ft (139 m) Queen Anne Hill summit quoted for ' +
        'the hill as a whole, not for the park.',
      url: 'https://en.wikipedia.org/wiki/Queen_Anne,_Seattle',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-rainier',
      title: 'Mount Rainier — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Mount_Rainier',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-baker',
      title: 'Mount Baker — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Mount_Baker',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-hood',
      title: 'Mount Hood — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Mount_Hood',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
  ],

  caveats: [
    'Egress to en.wikipedia.org, seattle.gov and commons.wikimedia.org is ' +
      'blocked by this build sandbox; all pages were read through the ' +
      'web-search index. Re-verify before using as a release gate.',
    'The observer ground elevation (113 m) is an ESTIMATE, not a sourced ' +
      'figure. Both assertions in this case were chosen to survive the full ' +
      '+-15 m band, and the Mount Baker verdict survives far more than that.',
    'Downtown Seattle skyscrapers stand between the camera and Mount Rainier. ' +
      'They are buildings, not terrain, so they are absent from SRTM and the ' +
      'pipeline will not model them. Rainier clears them in reality (this is ' +
      'why the shot is famous), but any future pixel-position assertion from ' +
      'this viewpoint must not treat the built skyline as a horizon.',
  ],
};
