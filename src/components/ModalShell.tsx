/**
 * ModalShell — the shared dialog chrome every modal used to hand-roll:
 * fixed overlay root (focus-trap registration point) + dim backdrop +
 * centered motion panel, with an optional accent header bar (icon + title +
 * ✕ close) above the caller's body.
 *
 * Presentational only: the host (AppModals) owns the <AnimatePresence> wrapper
 * and the open condition, so exit animations keep working; the dialog root is
 * exposed through `overlayRef` for the host's focus/escape registry. Body
 * content and scroll are the caller's — the panel clips overflow only.
 *
 * Variants are expressed as knobs, never as forked copies:
 *  - the default header is the themed-dark bar (`theme.header` background,
 *    `border-slate-50` hairline); pass `headerClassName` (+ optional
 *    `headerStyle`) to swap the palette (solid accent bars, light borders…);
 *  - panel width defaults to `max-w-lg`; other sizes via `maxWidth`;
 *  - nonstandard layouts (two-line titles, custom close affordances) render
 *    a full `header` override; `rootClassName` covers things like `no-print`.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { CurrentTheme } from '../app/mainViewsProps';
import { modalTokens } from '../lib/modalTokens';

export interface ModalShellProps {
  /** The dialog root — registered in the host overlay registry (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  /** Close handler — wired to the backdrop and the ✕ button. */
  onClose: () => void;
  currentTheme: CurrentTheme;
  /** `aria-labelledby` id on the root and on the header `<h2>`. */
  titleId: string;
  /** `aria-label` for assistive tech. */
  ariaLabel: string;
  /** Extra classes appended to the fixed root (e.g. `no-print`). */
  rootClassName?: string;
  /** Panel width token (default `max-w-lg`). */
  maxWidth?: 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-4xl';
  /** Extra classes appended to the panel (radius/scroll overrides). */
  panelClassName?: string;
  /** Fully custom header node — replaces the standard accent bar. */
  header?: ReactNode;
  /** Standard header bar: leading icon, styled by the caller. */
  icon?: ReactNode;
  /** Standard header bar: title content. */
  title?: ReactNode;
  /** Standard header bar: swap the default themed-dark bar classes. */
  headerClassName?: string;
  /** Standard header bar: inline style (applied only with `headerClassName`). */
  headerStyle?: CSSProperties;
  /** Standard header bar: title element classes (two-line layouts etc.). */
  titleClassName?: string;
  children?: ReactNode;
}

export function ModalShell({
  overlayRef,
  onClose,
  currentTheme,
  titleId,
  ariaLabel,
  rootClassName = '',
  maxWidth = 'max-w-lg',
  panelClassName = '',
  header,
  icon,
  title,
  headerClassName,
  headerStyle,
  titleClassName = 'text-xl font-bold flex items-center gap-3',
  children,
}: ModalShellProps) {
  const tokens = modalTokens(currentTheme);
  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={titleId}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${rootClassName}`}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className={tokens.backdrop}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className={`relative ${tokens.panelSurface} w-full ${maxWidth} rounded-[3rem] shadow-2xl overflow-hidden ${panelClassName}`}
      >
        {header ?? (
          <div
            className={headerClassName ?? tokens.headerBar}
            style={headerClassName ? headerStyle : { backgroundColor: currentTheme.header }}
          >
            <h2 id={titleId} className={titleClassName}>
              {icon}
              {title}
            </h2>
            <button onClick={onClose} className={tokens.headerClose}>
              <X size={20} />
            </button>
          </div>
        )}
        {children}
      </motion.div>
    </div>
  );
}
