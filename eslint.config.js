// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.vercel/**',
      '.freebuff/**',
      'coverage/**',
      'supabase/**',
      'lh-vercel.json',
    ],
  },

  // TypeScript (app + tests): TS-recommended rules + the strict any/comment gate.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Hard gate: no explicit `any` may ever be reintroduced in TypeScript.
      '@typescript-eslint/no-explicit-any': 'error',
      // Type bypasses silently slip past `tsc` — ban them outright.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
      // Vite + React docs recommend keeping components HMR-friendly.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // rules-of-hooks is an error; exhaustive-deps surfaces as a warning.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // tsc already guards unused symbols; keep this gate focused on the any-policy.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Node scripts and config files: core recommended rules minus the noise that has
  // nothing to do with the any gate (browser-globals scripts, regex style).
  {
    files: ['**/*.{js,mjs}', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Some dev scripts drive a headless browser and reference document/window.
      'no-undef': 'off',
      // Regex character-class spaces are intentional there.
      'no-regex-spaces': 'off',
      'no-unused-vars': 'off',
    },
  },
);