/**
 * Palette de commandes — `Ctrl+K` (ou `⌘K`) pour aller à un écran sans souris.
 *
 * L'audit d'usage a relevé 284 boutons pour 4 gestionnaires de clavier : au
 * guichet, chaque geste repassait par la souris, alors que le poste se conduit
 * debout, une main sur le reçu. La palette ne remplace pas les onglets ; elle
 * donne UN chemin court vers eux, et elle est le seul endroit où la liste des
 * écrans est aussi une liste de recherche.
 *
 * Elle DEMANDE ses droits à `canOpenTab` (`src/app/tabRights.ts`), la seule
 * table qui nomme un onglet réservé : un écran fermé à un rôle ne doit pas
 * apparaître ici et refuser ensuite (le défaut du 2026-10-15, où le rail
 * montrait un onglet que le shell ramenait au tableau de bord).
 *
 * Le dialogue est écrit à la main plutôt qu'avec `ModalShell` pour UNE raison :
 * le champ de recherche doit recevoir le focus à l'ouverture, et `useFocusTrap`
 * sait le faire (`initialFocus`), là où le chrome partagé se rabat sur le
 * premier focalisable (le ✕). Le reste — piège de focus, retour du focus,
 * `Échap` — vient des mêmes modules que les autres fenêtres.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { useFocusTrap } from '../lib/focusStack';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { canOpenTab } from '../app/tabRights';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from './Sidebar';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  t: TranslationDict;
  currentTheme: CurrentTheme;
  /** Le rôle du compte connecté — la palette ne montre que ce qu'il peut ouvrir. */
  role: string | null | undefined;
  onSelect: (tab: AppTab) => void;
}

/**
 * Les écrans, dans l'ordre du rail. La table est LOCALE à la palette et ne
 * prétend pas remplacer les deux navigations : elle dit ce qu'on peut chercher,
 * et `canOpenTab` décide ce qui s'affiche.
 */
const SCREENS: ReadonlyArray<{ tab: AppTab; label: keyof TranslationDict }> = [
  { tab: 'dashboard', label: 'navDashboard' },
  { tab: 'students', label: 'navStudents' },
  { tab: 'parents', label: 'navParents' },
  { tab: 'payroll', label: 'payroll' },
  { tab: 'expenses', label: 'expenses' },
  { tab: 'calendar', label: 'navCalendar' },
  { tab: 'notes', label: 'notes' },
  { tab: 'archives', label: 'navArchives' },
  { tab: 'silentReceipts', label: 'navSilentReceipts' },
  { tab: 'audit', label: 'auditTrail' },
  { tab: 'paymentHistory', label: 'paymentHistory' },
  { tab: 'settings', label: 'navSettings' },
];

/** Comparaison insensible à la casse ET aux accents (« eleves » trouve « Élèves »). */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function CommandPalette({ open, onClose, t, currentTheme, role, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, () => rootRef.current, '#command-palette-input');
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const results = useMemo(() => {
    const needle = fold(query.trim());
    return SCREENS.filter((screen) => canOpenTab(screen.tab, role)).filter((screen) => {
      if (!needle) return true;
      return fold(String(t[screen.label])).includes(needle);
    });
  }, [query, role, t]);

  if (!open) return null;

  const choose = (tab: AppTab): void => {
    onSelect(tab);
    onClose();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      className="fixed inset-0 z-[70] flex items-start justify-center pt-24 px-4"
    >
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full max-w-md ${currentTheme.card} border ${currentTheme.border} rounded-2xl shadow-2xl overflow-hidden`}
      >
        <h2 id="command-palette-title" className="sr-only">{t.commandPaletteTitle}</h2>
        <div className={`flex items-center gap-3 px-4 py-3 border-b ${currentTheme.border}`}>
          <Search size={16} className={currentTheme.muted} />
          <input
            id="command-palette-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results.length > 0) {
                event.preventDefault();
                choose(results[0].tab);
              }
            }}
            aria-label={t.commandPalettePlaceholder}
            placeholder={t.commandPalettePlaceholder}
            autoComplete="off"
            className={`flex-1 bg-transparent border-0 outline-none text-sm font-semibold ${currentTheme.inkStrong} placeholder:opacity-60`}
          />
          <kbd className={`text-3xs font-black ${currentTheme.muted} border ${currentTheme.border} rounded px-1.5 py-0.5`}>{t.shortcutEsc}</kbd>
        </div>

        {results.length === 0 ? (
          <p className={`px-4 py-6 text-xs font-semibold ${currentTheme.muted}`} role="status">
            {t.commandPaletteEmpty}
          </p>
        ) : (
          <ul data-slot="command-palette-results" className="max-h-80 overflow-y-auto py-1">
            {results.map((screen) => (
              <li key={screen.tab}>
                <button
                  type="button"
                  onClick={() => choose(screen.tab)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-bold ${currentTheme.inkStrong} ${currentTheme.hoverSurface}`}
                >
                  <span>{t[screen.label]}</span>
                  <CornerDownLeft size={12} className={`${currentTheme.muted} opacity-0`} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
