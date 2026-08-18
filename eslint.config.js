import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // v1 is retired reference material — never linted, never built.
      'archive/**',
      // Gitignored scratch space for review agents demonstrating findings.
      // tsconfig.json already excludes it for exactly this reason: nothing
      // there ships, and a half-written probe must not break `npm run check`
      // for everyone else. Lint was still walking into it and failing on 30
      // `any`s in throwaway files.
      'tests/scratch/**',
      // Same reason, top-level: .gitignore calls scratch/ "Agent scratch space —
      // never committed". It was excluded from tsconfig but not from lint, so a
      // half-written probe still red-lined `npm run check` for everyone.
      'scratch/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Metro reads its config through Node's CommonJS loader before any bundler
    // is involved, so this one file cannot be ESM. Scoped to the file rather
    // than exempting `mobile/**`, which is ordinary linted TypeScript.
    files: ['mobile/metro.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
