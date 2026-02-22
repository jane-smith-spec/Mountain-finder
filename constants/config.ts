export const CONFIG = {
  // Search radius for nearby peaks (km)
  PEAK_SEARCH_RADIUS_KM: 100,

  // Maximum peaks to display at once
  MAX_PEAKS_DISPLAYED: 30,

  // Camera field of view (degrees) — typical smartphone wide-angle lens
  CAMERA_HFOV: 60,
  CAMERA_VFOV: 45,

  // OpenTopoData SRTM elevation API (free, no key needed)
  ELEVATION_API_BASE: 'https://api.opentopodata.org/v1',
  ELEVATION_DATASET: 'srtm90m',

  // OpenStreetMap Overpass API for peak data
  OVERPASS_API_URL: 'https://overpass-api.de/api/interpreter',

  // Max visible distance
  MAX_RENDER_DISTANCE_KM: 100,

  // Sample distances used when building the horizon silhouette profile (km)
  HORIZON_SAMPLE_DISTANCES_KM: [2, 5, 10, 20, 40, 70, 100],

  // Angular step between horizon rays (degrees). Lower = more accurate but more API calls.
  HORIZON_ANGULAR_RESOLUTION_DEG: 2,

  // Observer eye height above GPS/terrain elevation
  OBSERVER_EYE_HEIGHT_M: 1.7,

  // Minimum distance the user must move before terrain data is re-fetched (km)
  REFETCH_THRESHOLD_KM: 0.5,

  // Delay between OpenTopoData batch requests (ms) — be polite to free APIs
  API_BATCH_DELAY_MS: 250,
} as const;
