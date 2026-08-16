/**
 * Data providers (PLAN.md Phase 2).
 *
 * Everything the pipeline needs from the outside world, behind an injectable
 * transport. Import `fixture-store.js` separately — it is node-only.
 */

export { ProviderError, isProviderError } from './errors.js';
export type { ProviderErrorCode, ProviderErrorDetails } from './errors.js';

export {
  canonicalBody,
  canonicalUrl,
  fixtureKey,
  fixtureKeyHash,
  parseJsonBody,
} from './transport.js';
export type {
  HttpMethod,
  RequestBody,
  Sleep,
  Transport,
  TransportRequest,
  TransportResponse,
} from './transport.js';

export { FetchTransport } from './fetch-transport.js';
export type { FetchLike, FetchTransportOptions } from './fetch-transport.js';

export { FixtureTransport, exchangeBodyText } from './fixture-transport.js';
export type { RecordedExchange } from './fixture-transport.js';

export {
  MAX_LOCATIONS_PER_REQUEST,
  OpenTopoDataElevationProvider,
  SRTM90M_URL,
  batchPoints,
  elevationRequestUrl,
  formatLocations,
  toElevationSamples,
} from './elevation.js';
export type {
  ElevationProvider,
  ElevationRequestOptions,
  ElevationResult,
  NoDataPolicy,
  OpenTopoDataOptions,
} from './elevation.js';

export {
  OVERPASS_URL,
  OverpassPeaksProvider,
  buildPeaksQuery,
  feetToMetres,
  parseEleFeet,
  parseEleMetres,
  parsePeaksResponse,
  resolvePeakElevations,
} from './peaks.js';
export type {
  BoundingBox,
  OverpassOptions,
  PeakCandidate,
  PeakSearchArea,
  PeaksProvider,
  PeaksRequestOptions,
  ResolvedPeaks,
} from './peaks.js';
