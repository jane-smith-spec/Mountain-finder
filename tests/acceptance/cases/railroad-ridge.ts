/**
 * PHOTO CASE — RAILROAD RIDGE ROAD, WHITE CLOUD MOUNTAINS, IDAHO
 * ═══════════════════════════════════════════════════════════════════════════
 * Photograph: `fixtures/photos/real/tundra-blue-sky.jpeg`, supplied 2026-08-17.
 * Broad tundra foreground, a jagged rock skyline, snowfield against bright
 * cloud on the left and dark rock against blue sky on the right.
 *
 * This is the strong half of the pair. The skyline extractor resolves 506 of
 * 512 columns on it (98.8 % coverage, mean confidence 0.575), so it is the one
 * photograph in this repository on which recovering a heading from terrain is a
 * realistic prospect. It still has no heading today, and this file asserts
 * nothing that would need one.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS ESTABLISHED, AND HOW
 * ───────────────────────────────────────────────────────────────────────────
 *     Photographer   44°08'20.4"N 114°35'44.5"W  =  44.13900, −114.59569
 *     SRTM N44W115 at that point                    3166.1 m = 10,387 ft
 *     Published Railroad Ridge crest                10,433 ft = 3180 m
 *
 * The middle line is a reading of the same radar data the committed window
 * holds, so it is a FIXTURE-INTEGRITY check and is labelled as one. The third
 * is the independent one: a published elevation for the ridge this road runs
 * along, 14 m above the DEM at the supplied point — which is what a point ON a
 * ridge road should read against the ridge's own high point. A coordinate typed
 * wrong by a digit lands in a valley and misses by hundreds of metres.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT ESTABLISHED — AND IS THEREFORE ASSERTED NOWHERE
 * ───────────────────────────────────────────────────────────────────────────
 * • THE VIEW BEARING. EXIF carries orientation and dimensions only; no GPS, no
 *   `GPSImgDirection` (asserted from the committed file). `view.bearingDeg` is
 *   `null` and the type will not take a number. The photograph looks across
 *   tundra at a jagged skyline, and the named White Cloud summits happen to lie
 *   in a southward arc of roughly 170–230° — that arc is recorded in
 *   `view.plausibleArcDeg` as WHERE THE MOUNTAINS ARE, which is not evidence of
 *   where the camera pointed, and it is asserted nowhere.
 * • WHICH SUMMITS ARE IN THE FRAME. Seventeen named summits stand within the
 *   7.5 km window and thirty-two within 25 km; several of them are within a few
 *   degrees of one another from here. Picking the ones the pipeline would
 *   compute and calling them ground truth is precisely the circularity
 *   CLAUDE.md rule 4 forbids.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ONE MEASURED FACT ABOUT THE COMMITTED WINDOW
 * ───────────────────────────────────────────────────────────────────────────
 * The window's highest sample is 3503 m at 44.11833 N, 114.62083 W — 268 m east
 * of the Calkens Peak node, whose tagged height is 3509 m. So SRTM under-reads
 * this summit by 6 m AND displaces its maximum by a quarter of a kilometre,
 * which is the behaviour MISSION.md documents for sharp tops and the reason
 * summit heights in this case come from the peak dataset and never from these
 * bytes. Recorded as a DEM reading; it gates nothing.
 */

import type { PhotoCase } from './photo-case-types';

export const railroadRidgeCase: PhotoCase = {
  id: 'railroad-ridge',
  title: 'Railroad Ridge Road (FR 669), White Cloud Mountains, Custer County, Idaho',

  photo: {
    path: 'fixtures/photos/real/tundra-blue-sky.jpeg',
    widthPx: 4032,
    heightPx: 3024,
    orientation: 1,
    absentFields: [
      'lat',
      'lon',
      'gpsAltitudeM',
      'imgDirectionDeg',
      'imgDirectionRef',
      'focalLengthMm',
      'focalLength35mmMm',
      'hFovDeg',
      'vFovDeg',
    ],
    note:
      'EXIF did not survive the upload path: orientation and dimensions only. ' +
      'The position below came from the photographer separately, in degrees, ' +
      'minutes and seconds — not from this file.',
  },

  terrainWindowCaseId: 'railroad-ridge',

  observer: {
    lat: 44.139,
    lon: -114.59569,
    // SRTM N44W115 at the supplied coordinate. NOT an independent source for
    // this position — see the cross-check below for the one that is.
    groundElevationM: 3166,
    // Tight on purpose: this figure is a reading of the very data the committed
    // window holds, so anything but agreement means the window was cut wrong.
    groundElevationUncertaintyM: 2,
    eyeHeightM: 1.6,
    eyeHeightNote:
      'A standing observer. Railroad Ridge Road is a high-clearance 4WD track ' +
      'and a photograph taken from a vehicle would sit roughly a metre higher; ' +
      'which this is has not been established. No assertion here depends on it.',
    positionSourceId: 'photographer-supplied-position',
    elevationSourceId: 'srtm-window-railroad-ridge',
    crossChecks: [
      {
        valueM: 3166,
        sourceId: 'idaho-photo-cases-doc',
        agreementToleranceM: 2,
        note:
          'The reading docs/IDAHO-PHOTO-CASES.md records for SRTM N44W115 at ' +
          'this coordinate (3166.0 m = 10,387 ft). Same radar data as the ' +
          'window, so this is a fixture-integrity check: it catches a window ' +
          'cut from the wrong rows or columns, not a wrong position.',
      },
      {
        valueM: 3180,
        sourceId: 'dangerousroads-railroad-ridge',
        agreementToleranceM: 30,
        note:
          'Railroad Ridge is published as 3,180 m / 10,433 ft, the high point ' +
          'of the road. Independent of both the photographer and the DEM. The ' +
          'camera stands 14 m below it, which is what a point ON a ridge road ' +
          'rather than at its summit should read — the check that matters is ' +
          'that this is metres, not the hundreds a mistyped coordinate gives.',
      },
    ],
  },

  view: {
    bearingDeg: null,
    measured: false,
    note:
      'UNMEASURED. No GPSImgDirection in the file, and the photographer ' +
      'supplied a position but not a heading. This is the photograph the ' +
      'aligner should eventually recover a heading FROM — 98.8 % skyline ' +
      'coverage — which is the whole reason no heading is written here: a ' +
      'supplied guess would contaminate the one case that can test recovery.',
    plausibleArcDeg: {
      fromDeg: 170,
      toDeg: 230,
      basis:
        'WHERE THE NAMED SUMMITS ARE, not where the camera pointed. Castle ' +
        'Peak (176 deg), Mount Andrus (191 deg), Lee Peak (213 deg), WCP-10 ' +
        '(205 deg) and Calkens Peak (225 deg) all lie in this arc, and the ' +
        'photograph shows a jagged skyline. That is consistency, not evidence: ' +
        'the White Clouds also fill the western arc, and nothing here rules it ' +
        'out. Asserted nowhere in the suite.',
    },
  },

  peakDataset: {
    region: 'idaho-central',
    indexPath: 'fixtures/peaks/regions/idaho-central/index.json',
    queryRadiusKm: 25,
    namedSummitsWithinRadius: 32,
  },

  summits: [
    {
      name: 'WCP-10',
      peakId: 'overture/e5be4fc9-feea-350c-9ac3-5aaf86364eda',
      location: { lat: 44.11758, lon: -114.60978 },
      elevationM: 3378,
      bearingDeg: 205.3,
      distanceKm: 2.634,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The nearest named summit, 212 m above the camera at 2.6 km. Almost ' +
        'certainly a prominent shape from somewhere on this ridge — but "from ' +
        'somewhere" is not "in this frame", and there is no bearing to decide ' +
        'with. The numbered White Cloud Peaks are authentic OSM names, not ' +
        'placeholders.',
    },
    {
      name: 'Calkens Peak',
      peakId: 'overture/350801c4-65c0-38fc-a07d-0cd8abc3b5e8',
      location: { lat: 44.1182, lon: -114.62418 },
      elevationM: 3509,
      bearingDeg: 224.5,
      distanceKm: 3.243,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The highest summit inside the committed window, and the one the DEM ' +
        'under-reads by 6 m while displacing its maximum 268 m east. No view ' +
        'bearing, so no claim in either direction.',
    },
    {
      name: 'WCP-9',
      peakId: 'overture/419b0ad9-bdc7-3db2-9ecd-65e8291f6ad5',
      location: { lat: 44.11146, lon: -114.62627 },
      elevationM: 3433,
      bearingDeg: 218.6,
      distanceKm: 3.916,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'Sits between WCP-10 and Calkens Peak in both bearing and range, which ' +
        'is exactly the configuration where a labelling error is invisible ' +
        'without ground truth. Unverified until a bearing exists.',
    },
    {
      name: 'Lee Peak',
      peakId: 'overture/adc5b8be-7c12-3d4a-9d99-b35c57128513',
      location: { lat: 44.10281, lon: -114.62862 },
      elevationM: 3458,
      bearingDeg: 213.2,
      distanceKm: 4.807,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved: 'In the southward arc, inside the window, and unverified. No bearing exists.',
    },
    {
      name: 'White Cloud Peaks',
      peakId: 'overture/19dba544-94a5-32bf-b28c-0bdd39c78bab',
      location: { lat: 44.09734, lon: -114.62788 },
      elevationM: 3438,
      bearingDeg: 209,
      distanceKm: 5.297,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'A node named for the whole range as well as a point in it — the sort ' +
        'of name that must never be matched on rather than on its id. ' +
        'Unverified in the frame like the rest.',
    },
    {
      name: 'Mount Andrus',
      peakId: 'overture/0776bca9-9b16-332c-aa45-718ae4a25b2d',
      location: { lat: 44.09107, lon: -114.60921 },
      elevationM: 3438,
      bearingDeg: 191.4,
      distanceKm: 5.438,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'Same tagged height as White Cloud Peaks, 18 deg apart in bearing. ' +
        'Unverified: no bearing, no claim.',
    },
    {
      name: 'Lonesome Lake Peak',
      peakId: 'overture/5bc30935-3698-3357-88f5-b14dfa636da7',
      location: { lat: 44.07531, lon: -114.61207 },
      elevationM: 3445,
      bearingDeg: 190.5,
      distanceKm: 7.202,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The farthest summit still inside the committed window, and within a ' +
        'degree of Mount Andrus in bearing while standing 1.8 km behind it — ' +
        'an occlusion question this case is deliberately not answering.',
    },
    {
      name: 'Castle Peak',
      peakId: 'overture/203be435-c056-3359-be91-af61ed803d09',
      location: { lat: 44.0398, lon: -114.58698 },
      elevationM: 3603,
      bearingDeg: 176.4,
      distanceKm: 11.052,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: false,
      unresolved:
        'The high point of the White Clouds and the obvious anchor for the ' +
        'range — which is why it is recorded, and why it would be the ' +
        'temptation to assert. It is 11.1 km out, OUTSIDE the committed 7.5 km ' +
        'window, so even the terrain between here and there is unread: a ' +
        'window that stops short can produce a false VISIBLE. Two reasons to ' +
        'assert nothing, not one.',
    },
  ],

  visibility: {
    status: 'unverified',
    blockedOn:
      'A view bearing — to be RECOVERED from the terrain by src/cv\'s aligner ' +
      'on this photograph rather than supplied, since this is the one ' +
      'photograph in the repository whose skyline the extractor reads well.',
    note:
      'No summit here is asserted visible or hidden. The eight recorded above ' +
      'are the nearest by bearing from the camera; asserting any of them would ' +
      'mean deriving the answer from the same geometry the pipeline uses, ' +
      'which is not ground truth but an echo. When a bearing exists and the ' +
      'summits in the frame are IDENTIFIED, they belong in a GroundTruthCase ' +
      'with must-see and must-not-see lists — this file is what precedes that, ' +
      'not a permanent home for it.',
  },

  sources: [
    {
      id: 'photographer-supplied-position',
      title:
        'Camera position supplied by the photographer, 2026-08-17: ' +
        '44 deg 08\' 20.4" N, 114 deg 35\' 44.5" W',
      locator: 'docs/IDAHO-PHOTO-CASES.md',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Converted to decimal degrees as 44.13900, -114.59569 (44 + 8/60 + ' +
        '20.4/3600 = 44.139000; 114 + 35/60 + 44.5/3600 = 114.595694). Read ' +
        'off the photographer\'s own mapping app; recorded in ' +
        'docs/IDAHO-PHOTO-CASES.md, which is why the locator points there. It ' +
        'is not a source anyone else can re-fetch, and it is the only position ' +
        'evidence this case has.',
    },
    {
      id: 'overture-idaho-central',
      title:
        'Committed Overture Maps import of central Idaho (release 2026-06-17.0, ' +
        'base/land, class peak|volcano|ridge) — 709 named summits in 12 cells',
      locator: 'fixtures/peaks/regions/idaho-central/index.json',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Positions are the midpoint of Overture\'s float32 bbox (sub-metre for ' +
        'a point feature); heights are the OpenStreetMap `ele` tag carried ' +
        'through unchanged, never DEM samples. Note what is NOT in it: ' +
        '"Railroad Ridge" itself, because ridges carry no `ele` tag and the ' +
        'importer drops elevation-less records rather than invent a height.',
    },
    {
      id: 'srtm-window-railroad-ridge',
      title:
        'Committed SRTM1 window for this case: 505 x 703 samples cut ' +
        'byte-for-byte from N44W115 at row 2844, column 1098',
      locator: 'fixtures/tiles/cases/railroad-ridge-window.json',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Public-domain SRTM1 via the AWS elevation-tiles-prod "skadi" mirror. ' +
        '0 voids, 1886-3503 m. Its sidecar states what the window can and ' +
        'cannot prove; regenerate with `npm run fixtures:case-tiles`.',
    },
    {
      id: 'dangerousroads-railroad-ridge',
      title:
        'Railroad Ridge (FR 669), Custer County, Idaho — 3,180 m / 10,433 ft, ' +
        'described as the highest road in Idaho open to full-size vehicles',
      locator: 'https://www.dangerousroads.org/north-america/usa/6648-railroad-ridge.html',
      retrieved: '2026-08-17',
      access: 'via-search-index',
      note:
        'Read through the web-search index; direct egress is blocked by this ' +
        'build sandbox. A travel site, not a survey — which is why it backs a ' +
        '30 m tolerance and not a tighter one. It is nonetheless the only ' +
        'elevation evidence in this case that is independent of both the ' +
        'photographer and the DEM.',
    },
    {
      id: 'peakvisor-railroad-ridge',
      title: 'Railroad Ridge — PeakVisor, quoted at 2,941 m',
      locator: 'https://peakvisor.com/peak/railroad-ridge-22jhc0.html',
      retrieved: '2026-08-17',
      access: 'via-search-index',
      note:
        'Recorded as a DISAGREEING source, not as evidence. 2,941 m is 239 m ' +
        'below the published road high point and 225 m below what SRTM reads ' +
        'at the supplied coordinate, so it is most likely attached to a ' +
        'different point on the ridge. Nothing in this case uses it; it is ' +
        'here so that a later reader who finds it does not think it was ' +
        'missed.',
    },
    {
      id: 'idaho-photo-cases-doc',
      title:
        'docs/IDAHO-PHOTO-CASES.md — the running record of what was established ' +
        'about these two photographs, and how',
      locator: 'docs/IDAHO-PHOTO-CASES.md',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Where the supplied coordinate, the 3166.0 m SRTM reading, the 32 ' +
        'summits within 25 km and the 98.8 % extractor coverage are recorded, ' +
        'with the work that produced them.',
    },
    {
      id: 'photographer-supplied-photo',
      title: 'The photograph itself, supplied by the photographer on 2026-08-17',
      locator: 'fixtures/photos/real/tundra-blue-sky.jpeg',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Committed as bytes. EXIF: orientation 1, 4032 x 3024 px, nothing else ' +
        '— no GPS and no GPSImgDirection, which the suite asserts.',
    },
  ],

  caveats: [
    'The position rests on ONE source: the photographer. It is cross-checked ' +
      'against the terrain (a point on a ridge road reading 14 m below the ' +
      'published crest) but not corroborated by a second position, and a ' +
      'coordinate that is plausible is not a coordinate that is right. Any ' +
      'future visibility gate from this viewpoint should say so.',
    'The elevation cited for the observer is a DEM reading, so comparing it ' +
      'with the committed DEM window is a fixture-integrity check and NOT an ' +
      'independent confirmation. The independent line is the published ridge ' +
      'crest, at 30 m tolerance.',
    'The two published elevations for Railroad Ridge disagree badly: 3,180 m ' +
      '(dangerousroads) against 2,941 m (PeakVisor). Neither could be fetched ' +
      'directly from this sandbox. The DEM sides with the former; the ' +
      'disagreement is recorded rather than resolved.',
    'The bearings and distances recorded for each summit are computed from ' +
      'the dataset\'s own coordinates and the supplied camera position, so the ' +
      'suite\'s check of them is a check of TRANSCRIPTION into this file — not ' +
      'independent verification of where those summits are. Their coordinates ' +
      'and heights carry the Overture/OSM citation and nothing stronger.',
    'Castle Peak, Patterson Peak, Merriam Peak, Blackmon Peak and Mount Frank ' +
      'stand outside the committed window. A window that stops short can ' +
      'produce a false VISIBLE and never a false hidden, so if this case ever ' +
      'grows visibility claims about them, the window has to grow first.',
  ],
};
