/**
 * Reading and writing `fixtures/api/**` from disk.
 *
 * NODE ONLY — this is the one file in `src/providers` that touches the
 * filesystem. Keep it out of anything the web app imports; `FixtureTransport`
 * itself is pure and takes exchanges as data.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ProviderError } from './errors.js';
import { FixtureTransport, type RecordedExchange } from './fixture-transport.js';
import { fixtureKey, fixtureKeyHash } from './transport.js';

/** A parsed fixture file plus where it came from (for error messages). */
export interface LoadedFixture {
  readonly path: string;
  readonly exchange: RecordedExchange;
}

function isRecordedExchange(value: unknown): value is RecordedExchange {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { request?: unknown; response?: unknown };
  const request = candidate.request;
  const response = candidate.response;
  if (typeof request !== 'object' || request === null) return false;
  if (typeof response !== 'object' || response === null) return false;
  return (
    typeof (request as { url?: unknown }).url === 'string' &&
    typeof (response as { status?: unknown }).status === 'number'
  );
}

/** Every `*.json` under `dir`, recursively, sorted by path for determinism. */
export function loadFixtureFiles(dir: string): readonly LoadedFixture[] {
  const out: LoadedFixture[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecordedExchange(parsed)) {
      throw new ProviderError(
        'bad-response',
        `${path} is not a recorded exchange (needs request.url and response.status)`,
      );
    }
    out.push({ path, exchange: parsed });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Build a `FixtureTransport` from every recording in `dir`. */
export function loadFixtureTransport(dir: string): FixtureTransport {
  return new FixtureTransport(loadFixtureFiles(dir).map((f) => f.exchange));
}

/** Deterministic file name for a recording: readable slug + key hash. */
export function fixtureFileName(slug: string, exchange: RecordedExchange): string {
  return `${slug}-${fixtureKeyHash(fixtureKey(exchange.request))}.json`;
}

/** Write one recording as pretty JSON (diffable in review). */
export function writeFixture(dir: string, slug: string, exchange: RecordedExchange): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fixtureFileName(slug, exchange));
  writeFileSync(path, `${JSON.stringify(exchange, null, 2)}\n`, 'utf8');
  return path;
}
