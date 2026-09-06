/**
 * ModalTokens — semantic surface tokens for the shared dialog chrome.
 *
 * The single home of every fill the modal scaffold renders: ModalShell's
 * backdrop/panel/header-bar and the per-modal fixed surfaces (paper
 * previews, disabled fields). Components reference these tokens by
 * identifier; they never hardcode the fills themselves.
 *
 * STRUCTURAL DARK: PAIRING — every light fill (bg-*-50/100/200) defined
 * here carries its `dark:` counterpart in the same string. The repo's
 * midnight-lock scanner (tests/theme-contrast-remap.test.ts) only sees
 * string literals in .tsx, so fills that live in this module are policed
 * by tests/modal-tokens.test.ts instead of the exemption list — that is
 * what lets the exemption list shrink as surfaces migrate here.
 *
 * Paper surfaces (paperFill* / slip previews) repeat their light fill as
 * the `dark:` counterpart ON PURPOSE: they are fixed-light by design
 * (white paper is white even in midnight), and the explicit same-value
 * pairing is what documents that intent to the scanner.
 */
import type { CurrentTheme } from '../app/mainViewsProps';

export interface ModalTokens {
  /** Dim overlay behind the panel (ModalShell backdrop). */
  backdrop: string;
  /** Panel surface: theme card + hairline border (composed from currentTheme). */
  panelSurface: string;
  /** Default accent header bar (dark navy; theme.header via inline style). */
  headerBar: string;
  /** ✕ close button hover state on the header bar. */
  headerClose: string;
  /** Read-only / disabled form field (promoter-locked vendor fields). */
  fieldDisabled: string;
  /** Fixed-light paper surface, slate-50 family (slip preview, photo frame, summaries). */
  paperFillLight: string;
  /** Fixed-light paper surface, slate-100 family (print table head, badges). */
  paperFillMid: string;
  /** Fixed-light paper surface, rose-50 alert block (print). */
  paperFillAlert: string;
}

export function modalTokens(currentTheme: CurrentTheme): ModalTokens {
  return {
    backdrop: 'absolute inset-0 bg-slate-900/60 backdrop-blur-md',
    panelSurface: `${currentTheme.card} border ${currentTheme.border}`,
    headerBar: 'p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white',
    headerClose: 'p-2 hover:bg-white/10 rounded-xl transition-all',
    // Disabled fields dim to a proper dark inset in slate/midnight instead of
    // rendering as white chips. The dark text color is REQUIRED: these are
    // <input> elements, which do not inherit color (UA fieldtext stays black
    // — the page never declares color-scheme: dark), and midnight has no
    // `.theme-midnight input` rule. Slate overrides via its own !important
    // input rule; this utility is the midnight path.
    fieldDisabled: 'bg-slate-100 dark:bg-[#1E293B] dark:text-slate-300 cursor-not-allowed opacity-70',
    paperFillLight: 'bg-slate-50 dark:bg-slate-50',
    paperFillMid: 'bg-slate-100 dark:bg-slate-100',
    paperFillAlert: 'bg-rose-50 dark:bg-rose-50',
  };
}