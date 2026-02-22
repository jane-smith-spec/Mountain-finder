/**
 * peakService.ts
 *
 * Queries the OpenStreetMap Overpass API for mountain peaks within a radius
 * of the user's position.  Peak data is tagged with natural=peak in OSM.
 *
 * API docs: https://overpass-api.de/
 */

import axios from 'axios';
import { CONFIG } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Peak {
  /** Stable OSM node ID */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Elevation in metres (0 when not tagged in OSM) */
  elevationM: number;
  /** Optional alternative / local name */
  altName?: string;
}

// ─── Overpass API helpers ─────────────────────────────────────────────────────

interface OverpassElement {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Build an Overpass QL query that fetches all named peaks within `radiusM`
 * metres of (latitude, longitude).
 */
function buildOverpassQuery(
  latitude: number,
  longitude: number,
  radiusM: number,
): string {
  return `
    [out:json][timeout:30];
    (
      node["natural"="peak"]["name"](around:${radiusM},${latitude},${longitude});
    );
    out body;
  `.trim();
}

/**
 * Parse elevation from OSM tags.
 * OSM stores elevation in metres ("ele") or sometimes feet ("ele:ft").
 */
function parseElevation(tags: Record<string, string>): number {
  if (tags.ele) {
    const m = parseFloat(tags.ele);
    if (!isNaN(m)) return m;
  }
  if (tags['ele:ft']) {
    const ft = parseFloat(tags['ele:ft']);
    if (!isNaN(ft)) return Math.round(ft * 0.3048);
  }
  return 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch named peaks from OpenStreetMap within the given radius.
 *
 * Results are sorted by elevation (highest first) and capped at
 * CONFIG.MAX_PEAKS_DISPLAYED to keep the AR overlay legible.
 */
export async function fetchNearbyPeaks(
  latitude: number,
  longitude: number,
  radiusKm = CONFIG.PEAK_SEARCH_RADIUS_KM,
): Promise<Peak[]> {
  const radiusM = radiusKm * 1000;
  const query = buildOverpassQuery(latitude, longitude, radiusM);

  const { data } = await axios.post<OverpassResponse>(
    CONFIG.OVERPASS_API_URL,
    `data=${encodeURIComponent(query)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return data.elements
    .filter((el) => el.tags?.name)
    .map((el) => ({
      id: String(el.id),
      name: el.tags.name,
      latitude: el.lat,
      longitude: el.lon,
      elevationM: parseElevation(el.tags),
      altName: el.tags['name:en'] ?? el.tags.alt_name,
    }))
    .sort((a, b) => b.elevationM - a.elevationM)
    .slice(0, CONFIG.MAX_PEAKS_DISPLAYED);
}
