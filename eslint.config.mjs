import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import eos from './tools/eslint/index.mjs';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // WI-0001 explicitly requires a CommonJS dependency-cruiser configuration.
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  globalIgnores([
    '.next/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
    'drizzle/meta/**',
    'scripts/audit/tests/fixtures/**',
    'next-env.d.ts',
  ]),
  {
    files: ['**/*.{ts,tsx,mjs,cjs}'],
    plugins: { eos },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt'],
      'eos/environment': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: false, skipComments: false }],
      complexity: ['error', 12],
      'eos/cast-comments': 'error',
      'eos/sql-boundary': 'error',
      'eos/services-throw': 'error',
      'eos/server-marker': 'error',
      'eos/effect-sync': 'error',
      'eos/component-safety': 'error',
      'eos/component-limits': 'error',
      'eos/unknown-boundary': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'eos/no-color-literals': 'error',
      'eos/logical-props': 'error',
      'eos/styling': 'error',
      'eos/no-literal-strings': 'error',
    },
  },
  { files: ['**/*.tsx'], rules: { 'max-lines': ['error', 250] } },
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/tests/**',
      'e2e/**',
      'src/ui/primitives/**',
    ],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'eos/component-limits': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/tests/**', 'e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Toolchain configuration that runs before (or outside) the app: the build's worker count,
    // the browser suite's lanes and the scripts that prepare them read their own knobs
    // (NEXT_BUILD_CPUS, CI, E2E_WORKERS, E2E_LANE, E2E_CREDENTIALS_FILE) from the environment. The
    // app itself still goes through src/core/config/env.ts only.
    files: [
      'next.config.ts',
      'playwright.config.ts',
      'e2e/lanes.ts',
      'e2e/fixtures/test.ts',
      'e2e/global-setup.ts',
      'scripts/db/e2e-account.ts',
    ],
    rules: { 'eos/environment': 'off' },
  },
]);
