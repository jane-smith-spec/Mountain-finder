/**
 * GROUND-TRUTH CASE — GORNERGRAT, ZERMATT, SWITZERLAND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The opposite end of the difficulty scale from Mount Diablo. Every peak here
 * is 5–10 km away and stands 8–11° ABOVE the observer's horizontal. There is no
 * curvature subtlety and no occlusion knife-edge: if the pipeline gets the
 * geodesy and the sign conventions right it passes, and if it has the bearing
 * convention backwards or confuses elevationM with altitudeDeg it fails loudly.
 *
 * That makes it the calibration case of the set — the one that should never be
 * red for an interesting reason.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INDEPENDENT GEOMETRY CHECK (R = 6 371 008.8 m, k = 0.13, R_eff = R/(1−k))
 * ───────────────────────────────────────────────────────────────────────────
 * Eye at 3 089 + 1.6 = 3 090.6 m.
 *
 *   target          distance   bearing    altitudeDeg
 *   Matterhorn        9.6 km    265.4°      +8.2016°
 *   Dufourspitze      8.4 km    128.2°     +10.4398°
 *   Breithorn         5.4 km    210.0°     +11.1854°
 *
 * Worked example, the Matterhorn:
 *   d = 9.60 km, E = 4 478 m, H_o = 3 090.6 m
 *   c = d²/(2 R_eff) = 9.216e7 / 1.4646e7 = 6.29 m
 *   tan α = (4478 − 3090.6 − 6.29) / 9600 = 1381.11 / 9600 = 0.143866
 *   α = atan(0.143866) = 8.187°
 *
 * against +8.2016° from the exact model. The 0.015° residual is not a modelling
 * disagreement — it is this hand check rounding the haversine distance to
 * 9.6 km. 10 m of range error moves the angle by 0.008° at this geometry, which
 * is worth knowing: at short range these expectations are sensitive to the
 * COORDINATES, not to the Earth model.
 *
 * At these ranges the curvature term is 6 m out of a 1 381 m rise — 0.5% — so
 * the case says almost nothing about refraction. Mount Diablo and the synthetic
 * flat-plane scene carry that load; this one carries geodesy and conventions.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ON OCCLUSION
 * ───────────────────────────────────────────────────────────────────────────
 * No must-not-see peak is claimed here, and that is a deliberate omission
 * rather than an oversight. The Gornergrat panorama is famous precisely for
 * being unobstructed — the marketing copy counts 29 four-thousanders from one
 * spot — so any peak I nominated as hidden would be a guess. A guess in the
 * must-not-see list is worse than an empty list, because it teaches the
 * pipeline to be wrong. The occlusion load in this case set is carried by
 * Kerry Park (a clean, wide-margin block) and Fort William (a tight one).
 */

import type { GroundTruthCase } from './case-types';

export const gornergratCase: GroundTruthCase = {
  id: 'gornergrat',
  title: 'Gornergrat railway station / Kulmhotel, Zermatt, Valais, Switzerland',

  observer: {
    lat: 45.98333,
    lon: 7.78222,
    // 3 089 m is the railway station platform. The ridge crest and the
    // observation deck a short walk away are quoted at up to 3 135 m by the
    // railway's own tourism pages, hence the generous uncertainty: the two
    // numbers describe different spots, not a disagreement about one spot.
    groundElevationM: 3089,
    eyeHeightM: 1.6,
    groundElevationUncertaintyM: 25,
    positionSourceId: 'wp-gornergrat-station',
    elevationSourceId: 'wp-gornergrat-station',
  },

  view: {
    bearingDeg: 265,
    note:
      'Due west toward the Matterhorn — the standard postcard framing, and the ' +
      'direction of essentially every photograph taken from this platform.',
  },

  mustBeVisible: [
    {
      name: 'Matterhorn',
      location: { lat: 45.976389, lon: 7.658611 },
      elevationM: 4478,
      positionSourceId: 'wp-matterhorn',
      evidence: ['published-claim', 'multiple-independent-sources', 'own-geometry', 'photographic'],
      confidence: 'high',
      rationale:
        'The reason the railway exists. 9.6 km at bearing 265.4 deg, altitude ' +
        '+8.20 deg. Photographically documented from this exact platform under ' +
        'a free licence (see photos).',
    },
    {
      name: 'Dufourspitze',
      location: { lat: 45.936833, lon: 7.867056 },
      elevationM: 4634,
      positionSourceId: 'wp-dufourspitze',
      evidence: ['published-claim', 'own-geometry'],
      confidence: 'high',
      rationale:
        'Highest point in Switzerland and the summit of the Monte Rosa massif, ' +
        'named in the Gornergrat railway panorama material. 8.4 km at bearing ' +
        '128.2 deg, altitude +10.44 deg — nothing in an 8 km gap across the ' +
        'Gorner glacier basin can reach that angle.',
    },
    {
      name: 'Breithorn',
      location: { lat: 45.941111, lon: 7.747222 },
      elevationM: 4164,
      positionSourceId: 'wp-breithorn',
      evidence: ['published-claim', 'own-geometry'],
      confidence: 'high',
      rationale:
        'Named in the Gornergrat panorama material. 5.4 km at bearing 210.0 deg, ' +
        'altitude +11.19 deg, the highest angle of the three.',
    },
  ],

  mustNotBeVisible: [],

  disputed: [],

  photos: [
    {
      url: 'https://commons.wikimedia.org/wiki/File:Gornergrat_-_360%C2%B0-Panorama.JPG',
      licence: 'CC BY-SA 3.0',
      attribution: 'H. Zell, via Wikimedia Commons',
      note:
        'A 360-degree panorama shot from the Gornergrat. The single most useful ' +
        'image in this case set, because a full panorama can be compared ' +
        'against a full computed profile rather than one framed crop. Licence ' +
        'reported by the Commons search index; re-confirm on the file page ' +
        'before publishing anything derived from it. NOT downloaded into this ' +
        'repository — the URL is the deliverable.',
    },
  ],

  sources: [
    {
      id: 'wp-gornergrat-station',
      title: 'Gornergrat railway station — Wikipedia (45.9833 N, 7.7822 E; 3,089 m)',
      url: 'https://en.wikipedia.org/wiki/Gornergrat_railway_station',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'ggb-panorama',
      title: 'Twenty-nine 4,000-metre peaks all at once — Gornergrat Bahn',
      url: 'https://www.gornergrat.ch/en/stories/the-29-four-thousand-metre-peaks-from-gornergrat',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-matterhorn',
      title: 'Matterhorn — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Matterhorn',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-dufourspitze',
      title: 'Dufourspitze — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Dufourspitze',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-breithorn',
      title: 'Breithorn — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Breithorn',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
  ],

  caveats: [
    'Egress to en.wikipedia.org, gornergrat.ch and commons.wikimedia.org is ' +
      'blocked by this build sandbox, so all of these pages were read through ' +
      'the web-search index rather than fetched. Coordinates and the photo ' +
      'licence should be re-verified against the live pages.',
    'The Liskamm (4,527 m) is named alongside these three in the railway ' +
      'panorama material and is certainly visible, but no coordinate for it ' +
      'could be sourced in this environment, so it is deliberately absent ' +
      'rather than guessed at.',
    'The observer elevation spans a real 46 m range depending on whether the ' +
      'station platform (3,089 m) or the ridge observation deck (about 3,135 m) ' +
      'is meant. Over 5-10 km sightlines that shifts every altitude angle by up ' +
      'to 0.3 deg, so a pixel-accuracy test from here must pin down which spot ' +
      'the photograph was taken at.',
  ],
};
