# Where the deployment work lives in history

The packaging step, the static server, the deploy proof and `docs/DEPLOY.md` were
written by a dedicated agent but are committed under **`9f4c66e`
("fix: Wave 2 findings 1-3 + both gate repairs")**, whose message says nothing
about them. A coordinator `git add -A` swept the agent's working tree while it
was still running.

This is the fourth time in this session that a coordinator commit absorbed a
live agent's in-flight files (see also the void-weight fix, noted in `49a4822`).
The root cause is many parallel agents sharing one working directory. **Worktree
isolation is the fix**, and is worth using before the next wide fan-out.

Nothing was lost. What landed in `9f4c66e`:

| File | Purpose |
|---|---|
| `scripts/package-deploy.ts` | assembles `dist/terrain/` + `dist/peaks/` (`npm run package:deploy`) |
| `scripts/static-server.ts` | plain file server, no Vite (`npm run serve:dist`) |
| `scripts/deploy-check/` | the proof: built bundle behind that server (`npm run test:deploy`) |
| `docs/DEPLOY.md` | what to serve, sizes, missing-terrain behaviour, licensing |

The packager reuses `buildTerrainManifest` from the dev plugin rather than
listing tiles a second time, so a deployment serves exactly what `npm run dev`
serves — including the deliberate exclusion of synthetic test tiles, since
invented mountains at real coordinates is the failure this project exists to
prevent.
