// Metro has to reach OUTSIDE this directory, which is the whole point of the
// mobile app existing: P8.1's bar is that `/src/core` is imported by the Expo
// app **unchanged** — no fork, no shim, no copy to drift out of sync. So the
// repository root is a watch folder and the shared modules are imported by
// relative path from `mobile/src`.
//
// The second block is less obvious. This repository is TypeScript-with-ESM:
// `sensors.ts` imports `'./types.js'`, the extension the emitted JavaScript
// would have. Vite and vitest resolve that; Metro does not, and fails with
// "Unable to resolve ./types.js". Rather than rewrite every import in
// `/src` to suit one consumer — which would break the web build and violate
// P8.1's "unchanged" bar — the resolver tries the path as written first, and
// only on failure retries it with the extension stripped so Metro's normal
// sourceExts (ts, tsx, js…) apply. Original-first ordering matters: real
// `.js` files in node_modules must keep resolving to themselves.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
    throw error;
  }
};

module.exports = config;
