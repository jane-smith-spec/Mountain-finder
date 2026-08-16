/**
 * GROUND-TRUTH CASE — MOUNT DIABLO SUMMIT, CALIFORNIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Chosen because Mount Diablo is an isolated 1 173 m peak standing over flat
 * valleys, so it has one of the longest documented viewsheds in the contiguous
 * United States and California State Parks publishes an explicit list of what
 * you can see from the top. That published list is the ground truth; the
 * geometry below is an independent second opinion on it.
 *
 * It also carries the most instructive result in this whole case set: the
 * Yosemite claims about this viewpoint are genuinely contradictory in the
 * literature, and the arithmetic shows why — the margin is 0.004°. Those go in
 * `disputed`, not into either assertion list. See the note at the bottom.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INDEPENDENT GEOMETRY CHECK (all values computed from the cited coordinates
 * and elevations, using R_eff = R/(1−k), R = 6 371 008.8 m, k = 0.13)
 * ───────────────────────────────────────────────────────────────────────────
 * Eye at 1 173 + 1.6 = 1 174.6 m. Sea-horizon dip = −√(2·1174.6/R_eff)
 *   = −1.0262°. Anything below that is gone to curvature alone.
 *
 *   target                     distance   bearing   altitudeDeg   vs dip
 *   Mount Hamilton               64.6 km   158.2°     −0.1416°    +0.885°
 *   Mount Saint Helena          107.8 km   324.6°     −0.3427°    +0.684°
 *   Mount Tamalpais East Peak    60.1 km   274.7°     −0.6075°    +0.419°
 *   Lassen Peak                 291.9 km     6.8°     −0.7471°    +0.279°
 *   Half Dome                   209.7 km    93.4°     −0.4047°    +0.622°
 *   Sentinel Dome               205.2 km    94.2°     −0.4396°    +0.587°
 *
 * The three short-range targets also have to clear intervening relief, not just
 * the sea horizon. The tallest thing between Diablo and Tamalpais is the
 * Berkeley Hills, roughly 500 m at 25 km:
 *
 *   α = atan((500 − 1174.6 − 25000²/(2 R_eff)) / 25000)
 *     = atan((500 − 1174.6 − 21.3) / 25000) = −1.595°
 *
 * which is 1.0° BELOW Tamalpais. Nothing in the Coast Ranges gets near the
 * required height. Same argument, with even more room, for Hamilton and
 * Saint Helena.
 */

import type { GroundTruthCase } from './case-types';

export const mountDiabloSummitCase: GroundTruthCase = {
  id: 'mount-diablo-summit',
  title: 'Mount Diablo summit, Contra Costa County, California, USA',

  observer: {
    lat: 37.881697781,
    lon: -121.914154997,
    // 3 849 ft NAVD 88. The summit is a surveyed benchmark, hence the tight
    // uncertainty: the figure is a monument height, not a DEM read.
    groundElevationM: 1173,
    eyeHeightM: 1.6,
    groundElevationUncertaintyM: 3,
    positionSourceId: 'wp-mount-diablo',
    elevationSourceId: 'wp-mount-diablo',
  },

  view: {
    // Chosen so a 60° frame (285°–345°) holds both Mount Tamalpais at 274.7°
    // — just outside — and Mount Saint Helena at 324.6°. Note that visibility
    // below is asserted independently of this bearing; framing is a separate
    // concern handled by P1.4.
    bearingDeg: 300,
    note:
      'North-west across San Pablo Bay toward the northern Coast Ranges: the ' +
      'classic clear-winter-day view from the summit.',
  },

  mustBeVisible: [
    {
      name: 'Mount Hamilton',
      location: { lat: 37.341722, lon: -121.642833 },
      elevationM: 1300,
      positionSourceId: 'wp-mount-hamilton',
      evidence: ['published-claim', 'own-geometry'],
      confidence: 'high',
      rationale:
        'California State Parks names the Lick Observatory on Mount Hamilton ' +
        'among the summit landmarks. Geometry agrees with room to spare: ' +
        '64.6 km at bearing 158.2 deg, altitude -0.142 deg, which is 0.885 deg ' +
        'above the sea horizon, and the Diablo Range between the two peaks tops ' +
        'out far below the sightline.',
    },
    {
      name: 'Mount Saint Helena',
      location: { lat: 38.669444, lon: -122.633611 },
      elevationM: 1323,
      positionSourceId: 'wp-mount-saint-helena',
      evidence: ['published-claim', 'own-geometry'],
      confidence: 'high',
      rationale:
        'Named by California State Parks ("north to Mount Saint Helena in the ' +
        'Coast Range at 4,344 feet"). Geometry: 107.8 km at bearing 324.6 deg, ' +
        'altitude -0.343 deg, 0.684 deg above the sea horizon.',
    },
    {
      name: 'Mount Tamalpais East Peak',
      location: { lat: 37.923922, lon: -122.596644 },
      elevationM: 784,
      positionSourceId: 'wp-mount-tamalpais',
      evidence: ['own-geometry'],
      confidence: 'high',
      rationale:
        'Not named individually in the State Parks list, which instead says the ' +
        'view runs "west beyond the Golden Gate Bridge to the Farallon Islands" ' +
        '- a longer and lower sightline in the same quadrant. Own geometry ' +
        'settles it: 60.1 km at bearing 274.7 deg, altitude -0.608 deg, 0.419 deg ' +
        'above the sea horizon, while the intervening Berkeley Hills (about ' +
        '500 m at 25 km) subtend only -1.595 deg, a full degree lower.',
    },
    {
      name: 'Lassen Peak',
      location: { lat: 40.488, lon: -121.5049 },
      elevationM: 3187,
      positionSourceId: 'wp-lassen-peak',
      evidence: ['published-claim', 'own-geometry'],
      confidence: 'medium',
      rationale:
        'California State Parks explicitly claims it ("still farther north to ' +
        'Lassen Peak in the Cascades at 10,466 feet"). Geometry supports it: ' +
        '291.9 km at bearing 6.8 deg, altitude -0.747 deg, 0.279 deg above the ' +
        'sea horizon. Marked MEDIUM rather than high only because at 292 km the ' +
        'result moves with the refraction coefficient: dropping k from 0.13 to ' +
        '0.00 costs about 0.29 deg and would extinguish it. It is a good test of ' +
        'whether k is being applied, but a poor test of anything else.',
    },
  ],

  // No hard must-not-see peak for this viewpoint. The obvious candidate is
  // Half Dome, and the research would not support asserting it - see below.
  mustNotBeVisible: [],

  disputed: [
    {
      name: 'Half Dome',
      location: { lat: 37.746111, lon: -119.533056 },
      elevationM: 2696,
      positionSourceId: 'wp-half-dome',
      evidence: ['published-claim', 'own-geometry'],
      conflict:
        'The Wikipedia article on Mount Diablo states that Half Dome is hidden ' +
        'behind an 8,000-foot ridge (which it locates at 37.755 N, 119.6657 W), ' +
        'while the California State Parks summit description invites visitors to ' +
        '"try to find Half Dome in Yosemite National Park with binoculars". Own ' +
        'geometry explains the disagreement instead of settling it: Half Dome ' +
        'lies at bearing 93.4 deg, 209.7 km out, altitude -0.4047 deg; the cited ' +
        'blocking ridge lies on the SAME bearing 93.4 deg, 198.0 km out, and at ' +
        '8,000 ft (2,438 m) subtends -0.4090 deg. Half Dome therefore clears it ' +
        'by 0.0043 deg - roughly 8 m of ridge height at that range. A ridge 30 m ' +
        'higher than the round 8,000 ft figure reverses the verdict. No ' +
        'assertion either way can be honest at that margin, so this peak is ' +
        'reported and never gated on.',
    },
    {
      name: 'Sentinel Dome',
      location: { lat: 37.7231, lon: -119.5866 },
      elevationM: 2476,
      positionSourceId: 'own-estimate-sentinel-dome',
      evidence: ['published-claim', 'own-geometry'],
      conflict:
        'Wikipedia states Sentinel Dome IS visible from Mount Diablo while Half ' +
        'Dome is not. Own geometry puts Sentinel Dome at bearing 94.2 deg, ' +
        '205.2 km, altitude -0.4396 deg - 0.035 deg LOWER than Half Dome, i.e. ' +
        'the opposite ordering to the published claim. Either the cited ridge ' +
        'geometry is more complicated than one number, or the claim is wrong. ' +
        'Its coordinate here is also the weakest in this file (see caveats), so ' +
        'this entry is recorded as an open question, not as ground truth.',
    },
  ],

  photos: [
    {
      url: 'https://commons.wikimedia.org/wiki/Category:Mount_Diablo',
      licence: 'per-file; not verified in this environment',
      attribution: 'various contributors, Wikimedia Commons',
      note:
        'Category page only. Direct egress to commons.wikimedia.org is blocked ' +
        'in this build sandbox, so no individual file licence could be read. ' +
        'Whoever adds a photo here must open the file page and record the ' +
        'actual licence and author before use.',
    },
  ],

  sources: [
    {
      id: 'wp-mount-diablo',
      title: 'Mount Diablo — Wikipedia (summit coordinates and elevation, USGS GNIS)',
      url: 'https://en.wikipedia.org/wiki/Mount_Diablo',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'ca-parks-diablo',
      title: 'Mount Diablo State Park — California Department of Parks and Recreation',
      url: 'https://www.parks.ca.gov/mountdiablo',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-hamilton',
      title: 'Mount Hamilton (California) — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Mount_Hamilton_(California)',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-saint-helena',
      title: 'Mount Saint Helena — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Mount_Saint_Helena',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-mount-tamalpais',
      title: 'Mount Tamalpais — Wikipedia (East Peak coordinates and elevation)',
      url: 'https://en.wikipedia.org/wiki/Mount_Tamalpais',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-lassen-peak',
      title: 'Lassen Peak — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Lassen_Peak',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'wp-half-dome',
      title: 'Half Dome — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Half_Dome',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
    {
      id: 'own-estimate-sentinel-dome',
      title:
        'Sentinel Dome coordinate — NOT independently sourced; approximate ' +
        'position used only for the disputed-entry arithmetic',
      url: 'https://en.wikipedia.org/wiki/Sentinel_Dome',
      retrieved: '2026-08-16',
      access: 'via-search-index',
    },
  ],

  caveats: [
    'Egress to en.wikipedia.org and parks.ca.gov is blocked by this build ' +
      'sandbox, so those pages were read through the web-search index rather ' +
      'than fetched directly. Coordinates should be re-verified against the ' +
      'live pages before this case is used as a release gate.',
    'The Sentinel Dome coordinate is the least reliable number in this file: ' +
      'it was not confirmed against a primary source and is used only inside ' +
      'the disputed entry, never in an assertion.',
    'Lassen Peak at 292 km is a refraction test as much as a terrain test. If ' +
      'the pipeline ever adopts a variable k, expect this expectation to move.',
    'All must-see altitude angles here are NEGATIVE - every one of these peaks ' +
      'is below the observer horizontal, seen down across the sea horizon. A ' +
      'pipeline that assumes visible peaks sit above 0 deg fails this case ' +
      'outright, which is exactly why it is in the set.',
  ],
};
