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
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { CurrentTheme } from '../app/mainViewsProps';
import { modalTokens } from '../lib/modalTokens';
import { trapFocus } from '../lib/focusTrap';

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
  maxWidth?: 'max-w-sm' | 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-3xl' | 'max-w-4xl' | 'max-w-5xl';
  /** Panel corner radius (default `rounded-3xl`). */
  panelRadius?: 'rounded-3xl' | 'rounded-3xl' | 'rounded-3xl' | 'rounded-3xl';
  /** Extra classes appended to the panel (scroll/padding overrides). */
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
  /**
   * `aria-label` du ✕. Sans lui, le bouton n'avait AUCUN nom : un lecteur
   * d'écran annonçait « bouton », et c'est le chrome de ~24 fenêtres. Les
   * appelants passent `t.close`.
   */
  closeLabel?: string;
  /**
   * La saisie en cours diffère de l'état d'ouverture. Quand c'est vrai, le
   * fond cliquable, le ✕ et `Échap` DEMANDENT avant d'abandonner au lieu de
   * jeter le travail commencé (audit : 0 garde de formulaire dans tout `src/`).
   */
  isDirty?: boolean;
  /** Textes de la demande d'abandon (traduits par l'appelant). */
  discardTitle?: string;
  discardMessage?: string;
  discardConfirmLabel?: string;
  discardCancelLabel?: string;
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
  panelRadius = 'rounded-3xl',
  panelClassName = '',
  header,
  icon,
  title,
  headerClassName,
  headerStyle,
  titleClassName = 'text-xl font-bold flex items-center gap-3',
  closeLabel = 'Close',
  isDirty = false,
  discardTitle = 'Discard this entry?',
  discardMessage = 'What you have typed will be lost.',
  discardConfirmLabel = 'Discard',
  discardCancelLabel = 'Keep editing',
  children,
}: ModalShellProps) {
  const tokens = modalTokens(currentTheme);
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const keepRef = useRef<HTMLButtonElement>(null);
  // Le dialogue PIÈGE le focus : sans cela, `Tab` sortait de la fenêtre de
  // saisie et parcourait la page derrière elle — un écran qu'un lecteur d'écran
  // annonce comme modal mais qui ne l'est pas au clavier. Le piège se pose sur
  // la RACINE (le ✕ est dedans) et se retire au démontage, en rendant le focus
  // à l'élément qui avait ouvert la fenêtre. Voir src/lib/focusTrap.ts.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return trapFocus(root);
  }, []);

  // Une saisie modifiée ne se jette pas sur un clic à côté.
  const requestClose = (): void => {
    if (isDirty) setAsking(true);
    else onClose();
  };

  // `Échap` est capté SUR LA RACINE, en phase de capture : la pile Échap de
  // l'app (`useEscapeToClose`) écoute en bulle sur `window`, donc elle décide
  // après nous — sans ça, `Échap` fermait la fenêtre en contournant la
  // demande. Un dialogue posé AU-DESSUS (confirmation de suppression) rend
  // hors de cette racine : son propre `Échap` ne passe pas par ici et continue
  // de fermer le dialogue du dessus, pas la saisie en dessous.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !isDirty) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      if (askingRef.current) {
        setAsking(false);
        return;
      }
      setAsking(true);
    };
    root.addEventListener('keydown', onKeyDown, true);
    return () => root.removeEventListener('keydown', onKeyDown, true);
  }, [isDirty]);

  // Les en-têtes PERSONNALISÉS (huit fenêtres) portent leur propre ✕, rendu par
  // l'appelant : il appelait `onClose` en direct et court-circuitait la
  // demande. On ne leur impose pas une signature : ils marquent leur bouton
  // `data-modal-close`, et ce capture-ci le renvoie vers la même demande — un
  // seul geste de fermeture pour tout le chrome de l'app.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !isDirty) return undefined;
    const onClickCapture = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const trigger = target?.closest('[data-modal-close]');
      if (!trigger || !root.contains(trigger)) return;
      if (askingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setAsking(true);
    };
    root.addEventListener('click', onClickCapture, true);
    return () => root.removeEventListener('click', onClickCapture, true);
  }, [isDirty]);

  // La demande d'abandon donne le focus à « Continuer la saisie » : une touche
  // `Entrée` réflexe ne doit pas confirmer la perte.
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  return (
    <div
      ref={(el) => { rootRef.current = el; overlayRef(el); }}
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
        onClick={requestClose}
        className={tokens.backdrop}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className={`relative ${tokens.panelSurface} w-full ${maxWidth} ${panelRadius} shadow-2xl overflow-hidden ${panelClassName}`}
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
            <button onClick={requestClose} data-modal-close className={tokens.headerClose} aria-label={closeLabel} title={closeLabel}>
              <X size={20} />
            </button>
          </div>
        )}
        {children}
        {asking && (
          <div
            data-slot="modal-discard-confirm"
            role="alertdialog"
            aria-label={discardTitle}
            className="border-t border-slate-200 dark:border-slate-800 p-4 bg-amber-50 dark:bg-amber-950/40 flex flex-col gap-3"
          >
            <div>
              <p className="text-sm font-black text-amber-900 dark:text-amber-200">{discardTitle}</p>
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mt-0.5">{discardMessage}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                ref={keepRef}
                type="button"
                onClick={() => setAsking(false)}
                className={`px-4 py-2 rounded-xl border ${currentTheme.border} text-xs font-bold ${currentTheme.inkStrong} ${currentTheme.hoverSurface}`}
              >
                {discardCancelLabel}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded-xl bg-rose-700 ${currentTheme.hoverAlertSolid} text-white text-xs font-bold`}
              >
                {discardConfirmLabel}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
