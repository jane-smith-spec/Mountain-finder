/**
 * `npm run demo -- <case>` — renders a ground-truth case to out/annotated.png,
 * the human-viewable proof that the pipeline works end to end.
 *
 * Phase 0: placeholder. Wired up once the renderer (P4.2) and ground-truth
 * cases (P6.2) land.
 */
const caseName = process.argv[2];

if (!caseName) {
  console.log('[demo] usage: npm run demo -- <case-name>');
} else {
  console.log(`[demo] requested case: ${caseName}`);
}
console.log('[demo] placeholder — writes out/annotated.png once P4.2 + P6.2 land.');
