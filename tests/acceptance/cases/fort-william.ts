/**
 * GROUND-TRUTH CASE — FORT WILLIAM, SCOTLAND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The hard occlusion case, and the one with the smallest margin in the set.
 *
 * Fort William brands itself the gateway to Ben Nevis, and yet the summit of
 * Ben Nevis cannot be seen from the town — the intervening Cow Hill mass gets
 * in the way. That is a well-worn local fact, repeated by tourism and
 * guidebook sources, and it is exactly the kind of counter-intuitive answer a
 * horizon pipeline exists to produce: the tallest mountain in Britain, 6.7 km
 * away, invisible behind a 287 m lump.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INDEPENDENT GEOMETRY CHECK (R = 6 371 008.8 m, k = 0.13, R_eff = R/(1−k))
 * ───────────────────────────────────────────────────────────────────────────
 * Eye at 10 + 1.6 = 11.6 m.
 *
 *   target               distance   bearing    altitudeDeg
 *   Ben Nevis              6.7 km    112.4°     +11.2346°
 *   Cow Hill (summit)      1.0 km    139.4°     +15.5429°
 *   Meall an t-Suidhe      4.4 km    113.0°      +9.0445°
 *
 * ── What the numbers actually say ───────────────────────────────────────────
 * Ben Nevis needs to be beaten by something at +11.23° or more ON ITS OWN
 * BEARING of 112.4°. Two candidates, and only one of them works:
 *
 *   • Meall an t-Suidhe (711 m) sits almost exactly on that bearing (113.0°)
 *     but only reaches +9.04°. It does NOT block. Anyone assuming the nearest
 *     big hill must be the blocker gets this wrong.
 *
 *   • Cow Hill's marked SUMMIT is at bearing 139.4° — 27° off the sightline —
 *     so the summit itself is not the blocker either. The blocker must be Cow
 *     Hill's north-eastern shoulder, where the ridge crosses bearing 112°.
 *
 * How much shoulder is needed? Terrain at ground distance x on bearing 112.4°
 * blocks Ben Nevis when its elevation exceeds
 *
 *     11.6 + x · tan(11.2346°) + x²/(2 R_eff)  ≈  11.6 + 0.19867 · x
 *
 *     x = 1.0 km  →  need > 211 m
 *     x = 1.2 km  →  need > 250 m
 *     x = 1.5 km  →  need > 310 m   (above Cow Hill's 287 m summit!)
 *
 * So the claim is true only if the ridge reaches roughly 250 m within about
 * 1.2 km on that bearing. Plausible for a hill whose summit is 287 m — but I
 * have no elevation data for the shoulder itself, so I cannot verify it here.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS 'medium' AND NOT 'high'
 * ───────────────────────────────────────────────────────────────────────────
 * The published claim is clear and repeated. My own arithmetic neither confirms
 * nor refutes it, because it turns on a ridge height I could not source. The
 * margin is around 1°, not the 6° of Kerry Park. So:
 *
 *   - it stays in mustNotBeVisible, because the sources do establish it;
 *   - it is marked confidence 'medium', so the acceptance suite reports a
 *     failure here as an INVESTIGATE rather than a hard gate.
 *
 * If this case ever fails, the first question is not "is the pipeline wrong"
 * but "what does the DEM say Cow Hill's shoulder is at 1.2 km, bearing 112°" —
 * and at that point the case can be promoted to 'high' or retired.
 */

import type { GroundTruthCase } from './case-types';

export const fortWilliamCase: GroundTruthCase = {
  id: 'fort-william',
  title: 'Fort William town centre, Lochaber, Highland, Scotland',

  observer: {
    lat: 56.819817,
    lon: -5.105218,
    // Sea-level town on the shore of Loch Linnhe.
    groundElevationM: 10,
    eyeHeightM: 1.6,
    groundElevationUncertaintyM: 8,
    positionSourceId: 'geo-fort-william',
    elevationSourceId: 'geo-fort-william',
  },

  view: {
    bearingDeg: 112,
    note:
      'East-south-east, straight at Ben Nevis — the direction a visitor points ' +
      'the camera expecting the summit and does not get it.',
  },

  mustBeVisible: [
    {
      name: 'Cow Hill',
      location: { lat: 56.813052, lon: -5.094644 },
      elevationM: 287,
      positionSourceId: 'outdooractive-cow-hill',
      evidence: ['own-geometry', 'published-claim'],
      confidence: 'high',
      rationale:
        'The hill immediately behind the town, 1.0 km away at bearing 139.4 deg ' +
        'and +15.54 deg high. Nothing stands between the town and the foot of ' +
        'its own hill, and walking routes up it start in the town centre. If a ' +
        'pipeline cannot see this it is broken at a level no subtle test will ' +
        'diagnose.',
    },
  ],

  mustNotBeVisible: [
    {
      name: 'Ben Nevis',
      location: { lat: 56.796849, lon: -5.003508 },
      elevationM: 1345,
      positionSourceId: 'wp-ben-nevis',
      evidence: ['published-claim', 'multiple-independent-sources'],
      confidence: 'medium',
      rationale:
        'Multiple independent sources state the summit cannot be seen from Fort ' +
        'William because Cow Hill blocks it, and that a view requires going out ' +
        'onto Loch Linnhe. Ben Nevis subtends +11.23 deg at bearing 112.4 deg, ' +
        'so the blocking ridge must reach about 250 m within 1.2 km on that ' +
        'bearing. Note that Meall an t-Suidhe (711 m, bearing 113.0 deg) is NOT ' +
        'the blocker: it only reaches +9.04 deg. Marked MEDIUM because the ' +
        'shoulder height could not be sourced here — see the module header.',
    },
  ],

  disputed: [],

  photos: [],

  sources: [
    {
      id: 'geo-fort-william',
      title:
        'Fort William, United Kingdom — coordinates 56.819817, -5.105218; ' +
        'altitude 10 m (gazetteer aggregator)',
      url: 'https://latitude.to/map/gb/united-kingdom/cities/fort-william',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-ben-nevis',
      title: 'Ben Nevis — Wikipedia (56°47′49″N 5°00′13″W; 1,345 m)',
      url: 'https://en.wikipedia.org/wiki/Ben_Nevis',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'outdooractive-cow-hill',
      title: 'Cow Hill viewpoint, Ben Nevis and Glen Coe — outdooractive.com',
      url: 'https://www.outdooractive.com/en/poi/ben-nevis-and-glen-coe/cow-hill/41290838/',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'walkhighlands-cow-hill',
      title: 'Cow Hill circuit, Fort William — Walkhighlands',
      url: 'https://www.walkhighlands.co.uk/fortwilliam/cowhill.shtml',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'guisachan-ben-nevis-view',
      title:
        'The best view of Ben Nevis — states the summit cannot be seen from the ' +
        'town because the view is blocked by Cow Hill',
      url: 'https://guisachanguesthouse.co.uk/the-best-view-of-ben-nevis/',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
  ],

  caveats: [
    'Every source here was read through the web-search index; direct egress to ' +
      'these hosts is blocked by this build sandbox.',
    'The Cow Hill summit coordinate came from a walking-route aggregator, not a ' +
      'national mapping agency. It is the least authoritative position in the ' +
      'whole case set. The Ordnance Survey grid reference should replace it ' +
      'before this case gates a release.',
    'The Meall an t-Suidhe coordinate used in the header arithmetic is ' +
      'approximate and appears in no assertion — it is shown only to rule that ' +
      'hill out as the blocker.',
    'This is the only case in the set whose must-not-see claim rests on a ' +
      'published assertion rather than on arithmetic I could close myself. It ' +
      'is marked confidence medium for exactly that reason.',
  ],
};
