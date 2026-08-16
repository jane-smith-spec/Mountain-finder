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
 * WHY THIS IS NOW 'high' — PROMOTED 2026-08-16
 * ───────────────────────────────────────────────────────────────────────────
 * It was 'medium', on the honest grounds that the published claim turned on a
 * ridge height nothing here could source, so a failure would have been an
 * INVESTIGATE rather than a bug. This paragraph used to end: "If this case ever
 * fails, the first question is not 'is the pipeline wrong' but 'what does the
 * DEM say Cow Hill's shoulder is at 1.2 km, bearing 112°' — and at that point
 * the case can be promoted to 'high' or retired."
 *
 * That question was put to the tiles (the section below) and answered: the
 * shoulder is 144 m at 0.63 km, reaching +12.00° against Ben Nevis's +11.244°,
 * with Glen Nevis 216 m below the crest in between. The unsourced quantity is
 * now measured, from a committed window, offline, at the native 30 m posting.
 * Nothing else about the claim was ever in doubt: multiple independent sources
 * state it, and the geometry check in this header rules out the obvious wrong
 * blocker (Meall an t-Suidhe) analytically.
 *
 * The promotion also fixes a hole the mutation testing found: mutating
 * `classifyOcclusion` to return 'self-occluded' unconditionally — which would
 * put a greyed label on every hidden summit in the product — survived every
 * `high`-confidence gate in the suite, because the one high-confidence
 * must-NOT-see claim (Mount Baker) passes via the classifier's COVERAGE
 * refusal rather than via a measured col. Ben Nevis is the one case in the set
 * whose blocking terrain is fully inside its committed window, so it is the
 * only place a measured col can be a hard gate. It is one now.
 *
 * What would still be re-examined first if it failed: the DEM reading of the
 * shoulder, not the published claim.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THE DEM ACTUALLY SAID (measured 2026-08-16, committed SRTM1 window
 * `fixtures/tiles/cases/fort-william`, cut from N56W006, 30 m posting)
 * ───────────────────────────────────────────────────────────────────────────
 * The question above was put to the tiles, and the answer settles both halves
 * of this case. SRTM reads the observer's own ground at **8.9 m** against the
 * cited 10 ± 8 m, so the eye sits at 10.5 m and the arithmetic in the header
 * stands to within a hundredth of a degree.
 *
 * ── Cow Hill: the summit point is behind the hill's OWN shoulder ───────────
 * Along bearing 139.4°, the marked summit at 0.99 km subtends **+15.603°**
 * (using the peak database's 287 m, never the DEM's). The ground crests
 * earlier and higher in ANGLE:
 *
 *     0.84 km   248 m   +15.81°      ← first terrain that gets in the way
 *     0.87 km   259 m   +15.96°      ← THE CREST: highest angle, i.e. the skyline
 *     0.90 km   265 m   +15.77°
 *     0.93 km   265 m   +15.29°
 *     0.96 km   264 m   +14.77°
 *
 * so the summit point loses by **0.356°** and is, correctly, HIDDEN. What the
 * table also shows is *how* it is hidden: from the crest at 0.87 km out to the
 * summit the ground never once falls back below that crest's 259 m — it climbs
 * to 265 m and stays there. **The deepest col between the two is 0.0 m.** There is no saddle, so there are not two landforms: the shoulder in
 * the way and the summit behind it are one hill, and that hill DOMINATES the
 * computed skyline, reaching **+17.02° at bearing 131.0°** (277 m at 0.87 km).
 *
 * That is why this case's must-see expectation is satisfied — honestly, with
 * the visibility rule untouched — by a GREYED label (decision D8, MISSION.md).
 * The claim on file was always about seeing the HILL; the pipeline agrees the
 * hill fills the view and says plainly that its last few metres of summit are
 * tucked behind its own curve.
 *
 * Two DEM facts worth recording alongside it, neither of which changes the
 * verdict: the quoted summit coordinate reads only **261 m** in SRTM against
 * the quoted 287 m, and the DEM's own local maximum is **293.6 m, some 476 m
 * SSE** of it. That is the ordinary SRTM behaviour for a rounded top, and it is
 * exactly why summit heights come from the peak database. It is also why the
 * self-occlusion test compares terrain against the blocking crest rather than
 * against the sightline to the summit: the latter would be measuring the
 * DEM's 26 m under-read, not the shape of the hill.
 *
 * ── Ben Nevis: hidden by a DIFFERENT hill, and the col proves it ───────────
 * The published claim is confirmed, and the blocker is neither of the
 * candidates the header could rule out from arithmetic alone. Along bearing
 * 112.4° the first terrain to beat Ben Nevis's +11.244° is **144 m of ground at
 * 0.63 km, reaching +12.00°** — Cow Hill's lower northern flank, comfortably
 * inside the "roughly 250 m within about 1.2 km" the header derived as
 * sufficient. Ben Nevis falls **4.011°** short.
 *
 * Beyond that flank the ground collapses into Glen Nevis, bottoming out at
 * **16 m**. Continuity is measured against the crest that FORMS THE SKYLINE on
 * this bearing — Cow Hill's mass at **232 m, 0.81 km, +15.29°**, the highest
 * thing in front of the mountain — which puts the col at **216.1 m**, deeper
 * than the crest stands above the town. (Measured from the first blocker at
 * 144 m instead, the col reads 128.5 m: the same verdict by a shallower
 * margin. Review 2's finding 1 is why the deeper, correct one is used — a
 * lower crest lowers the bar the intervening ground has to clear, which biases
 * toward labelling.) Two landforms, unambiguously. So Ben Nevis is
 * FOREGROUND-occluded and is never labelled, greyed or otherwise: none of it is
 * in the photograph.
 *
 * The header's arithmetic ruling out Meall an t-Suidhe (711 m, +9.04°) is
 * confirmed too — it never becomes the blocker at any range.
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
        'diagnose. MEASURED: the hill forms the skyline at +17.0 deg while the ' +
        'marked summit POINT sits 0.356 deg behind its own crest (259 m at ' +
        '0.87 km, +15.96 deg), with the ground rising unbroken between the two ' +
        '- deepest col 0.0 m. So this is satisfied by a GREYED label under D8, ' +
        'not by the summit clearing anything: the claim is about the hill, and ' +
        'the hill is unmistakably there.',
    },
  ],

  mustNotBeVisible: [
    {
      name: 'Ben Nevis',
      location: { lat: 56.796849, lon: -5.003508 },
      elevationM: 1345,
      positionSourceId: 'wp-ben-nevis',
      evidence: ['published-claim', 'multiple-independent-sources', 'own-geometry'],
      confidence: 'high',
      rationale:
        'Multiple independent sources state the summit cannot be seen from Fort ' +
        'William because Cow Hill blocks it, and that a view requires going out ' +
        'onto Loch Linnhe. Ben Nevis subtends +11.23 deg at bearing 112.4 deg, ' +
        'so the blocking ridge must reach about 250 m within 1.2 km on that ' +
        'bearing. Note that Meall an t-Suidhe (711 m, bearing 113.0 deg) is NOT ' +
        'the blocker: it only reaches +9.04 deg. PROMOTED to HIGH once the ' +
        'shoulder height stopped being unsourced — the committed 30 m window ' +
        'measures it, see the module header. MEASURED: blocked by 144 m of Cow ' +
        'Hill\'s northern flank at 0.63 km reaching +12.00 deg, falling 4.011 ' +
        'deg short, with Glen Nevis at 16 m between that flank and the summit - ' +
        'a col 216.1 m below the 232 m crest that forms the skyline here. ' +
        'Different landform, so this is FOREGROUND occlusion and the peak is ' +
        'never labelled. This is the only claim in the set whose blocking ' +
        'terrain lies wholly inside its committed window, which makes it the ' +
        'one hard gate a measured col can have.',
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
      'before this case gates a release. The DEM disagrees with it twice over: ' +
      'it reads 261 m there against the quoted 287 m, and its own local maximum ' +
      'is 293.6 m about 476 m SSE. Neither changes the verdict — the hill is ' +
      'self-occluding from this viewpoint at both positions — but a better ' +
      'coordinate would remove the last doubt.',
    'The measured figures in the module header are readings of the committed ' +
      'SRTM window, not independent ground truth. They are recorded so the ' +
      'case says what was actually found; the assertions that gate the build ' +
      'are the CLASSIFICATIONS (self-occluded vs foreground-occluded), which ' +
      'turn on the sign of a col depth rather than on its exact metres.',
    'The Meall an t-Suidhe coordinate used in the header arithmetic is ' +
      'approximate and appears in no assertion — it is shown only to rule that ' +
      'hill out as the blocker.',
    'This is the only case in the set whose must-not-see claim rests on a ' +
      'published assertion rather than on arithmetic I could close myself. It ' +
      'is marked confidence medium for exactly that reason.',
  ],
};
