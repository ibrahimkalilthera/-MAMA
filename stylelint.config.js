/**
 * Stylelint — strict gate (companion to scripts/check-css-selectors.mjs).
 *
 * Two rules, both chosen from the overlay-theming incidents of 2026-09:
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
 * Wired into `npm run lint` (pre-commit + CI quality job).
 */

/** @type {import('stylelint').Config} */
export default {
  reportNeedlessDisables: true,
  rules: {
    'declaration-no-important': true,
    'selector-max-compound-selectors': 3,
  },
};