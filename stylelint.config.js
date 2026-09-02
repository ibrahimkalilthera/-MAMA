/**
 * Stylelint — strict gate (companion to scripts/check-css-selectors.mjs).
 *
 * Rules, each chosen from the overlay-theming incidents of 2026-09:
 *
 *  • declaration-no-important — a naked `!important` outside the two carved
 *    zones (theme tokens, @media print) fails the lint. The theme sections
 *    NEED !important to beat Tailwind utilities, and @media print needs it
 *    to beat screen/inline styles; both zones carry scoped
 *    stylelint-disable comments in src/index.css. Any NEW use outside them
 *    fails — remove the need (scope by class) instead of reaching for
 *    !important. `reportNeedlessDisables` re-checks the zones: if a zone
 *    ever contains no violation at all (theme refactored away), the stale
 *    disable comment itself becomes a lint error.
 *
 *  • selector-max-compound-selectors: 3 — no selector chains deeper than
 *    three compound selectors (`.a .b .c` is the ceiling). Deeply nested
 *    selectors are how the white-on-white overlay bug crept in; the
 *    codebase is currently at zero violations.
 *
 *  • order/properties-alphabetical-order — every declaration block lists
 *    its properties alphabetically (stylelint-order). `stylelint --fix`
 *    applies it, so blocks stay deterministic and diff-friendly.
 *
 *  • scss/* — SCSS-pattern guards (stylelint-scss). index.css is plain
 *    CSS today, so these are dormant; if SCSS syntax ever lands here they
 *    already enforce the conventions: unknown at-rules fail (Tailwind
 *    v4 directives are allowlisted), duplicate $variables/mixins fail.
 *
 * Wired into `npm run lint` (pre-commit + CI quality job).
 */

/** @type {import('stylelint').Config} */
export default {
  reportNeedlessDisables: true,
  plugins: ['stylelint-order', 'stylelint-scss'],
  rules: {
    'declaration-no-important': true,
    'selector-max-compound-selectors': 3,
    'order/properties-alphabetical-order': true,
    'scss/at-rule-no-unknown': [
      true,
      {
        // Tailwind v4 directives + the at-rules already used in index.css
        // (import/keyframes/media) and the standard CSS at-rules.
        ignoreAtRules: [
          'tailwind', 'apply', 'layer', 'config', 'variants', 'responsive',
          'screen', 'theme', 'custom-variant', 'plugin', 'utility', 'reference',
          'import', 'keyframes', 'media', 'font-face', 'charset', 'namespace',
          'page', 'supports', 'counter-style', 'font-feature-values',
          'custom-media', 'document', 'host', 'property', 'viewport',
        ],
      },
    ],
    'scss/no-duplicate-dollar-variables': true,
    'scss/no-duplicate-mixins': true,
  },
};