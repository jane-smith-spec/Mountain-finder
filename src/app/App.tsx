/**
 * Phase 0 scaffold shell. Replaced by the real drop-zone / override panel /
 * overlay view in Phase 5 (PLAN.md P5.1).
 *
 * The `data-testid` below is the e2e canary: it proves the toolchain can
 * build, serve, and drive the app in a real browser.
 */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1 data-testid="app-title">Mountain Finder</h1>
      <p data-testid="app-phase">Phase 0 scaffold — pipeline not yet wired.</p>
    </main>
  );
}
