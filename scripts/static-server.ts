/**
 * A plain static file server — no Vite, no plugin, no application knowledge.
 *
 *   npx tsx scripts/static-server.ts dist --port 5210
 *
 * It exists so a packaged build (scripts/package-deploy.ts) can be proved to
 * work the way it will actually be deployed: bytes off a disk, over HTTP, with
 * nothing in the middle that understands terrain. Every rule below is one a
 * real static host (nginx, Caddy, S3+CloudFront, GitHub Pages) also implements:
 *
 *   • files are served verbatim from the directory given on the command line;
 *   • a request that escapes that directory is refused;
 *   • `foo.hgt.gz` is served for `foo.hgt` when the client accepts gzip, with
 *     `Content-Encoding: gzip` — nginx's `gzip_static`, Caddy's `precompressed`.
 *     The browser inflates it before `HttpTerrainStore` ever sees the bytes, so
 *     a 25 MB tile costs 16 MB on the wire with no application code involved;
 *   • unknown paths get 404 — there is deliberately no SPA rewrite, so a
 *     missing /terrain/ shows up as a missing file rather than as index.html
 *     arriving where a tile was expected.
 *
 * It is a test and preview harness. It is NOT the recommended way to run this
 * app in production; docs/DEPLOY.md says what is.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.hgt': 'application/octet-stream',
  '.i16be': 'application/octet-stream',
};

function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** The file a URL names, or `undefined` if it points outside the served root. */
export function resolveRequestPath(root: string, url: string): string | undefined {
  const raw = decodeURIComponent((url.split('?')[0] ?? '/').split('#')[0] ?? '/');
  const path = normalize(join(root, raw === '/' ? '/index.html' : raw));
  if (path !== root && !path.startsWith(root + sep)) return undefined;
  return path.endsWith(sep) ? join(path, 'index.html') : path;
}

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

async function handle(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = resolveRequestPath(root, request.url ?? '/');
  if (path === undefined) {
    response.statusCode = 403;
    response.end('Refused: that path leaves the served directory\n');
    return;
  }

  const acceptsGzip = (request.headers['accept-encoding'] ?? '').includes('gzip');
  const precompressed = `${path}.gz`;
  const gzipSize = acceptsGzip ? await sizeOf(precompressed) : undefined;
  const file = gzipSize === undefined ? path : precompressed;
  const size = gzipSize ?? (await sizeOf(path));

  if (size === undefined) {
    response.statusCode = 404;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(`404 ${request.url ?? ''}\n`);
    return;
  }

  response.setHeader('Content-Type', contentType(path));
  response.setHeader('Content-Length', String(size));
  if (gzipSize !== undefined) {
    response.setHeader('Content-Encoding', 'gzip');
    response.setHeader('Vary', 'Accept-Encoding');
  }
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function main(): void {
  const argv = process.argv.slice(2);
  const dir = argv.find((arg) => !arg.startsWith('--')) ?? 'dist';
  const portIndex = argv.indexOf('--port');
  const portArg = portIndex < 0 ? undefined : argv[portIndex + 1];
  const port = Number(portArg ?? process.env.PORT ?? 5210);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Bad --port ${String(portArg)}`);
  const root = resolve(process.cwd(), dir);

  createServer((request, response) => {
    handle(root, request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(`${error instanceof Error ? error.message : String(error)}\n`);
    });
  }).listen(port, () => {
    process.stdout.write(`Serving ${root} at http://localhost:${port}/\n`);
  });
}

main();
