import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { fiscaLocalPlugin } from './packages/qa-harness/src/eslint-rule-no-float-money.ts';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/*.generated.ts', 'docs/**', 'containers/**', 'connectors/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    plugins: { fisca: fiscaLocalPlugin },
    rules: { 'fisca/no-float-money': 'error' },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
