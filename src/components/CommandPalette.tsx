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
 * Depuis le 2026-11-09 elle ne se contente plus de changer d'écran : elle
 * COMMANDE aussi les deux gestes du guichet (« encaisser », « ajouter un
 * élève »), reçus du shell. Et `Entrée` ne prend plus le premier résultat : les
 * flèches choisissent, comme partout ailleurs — choisir toujours le premier
 * rendait la palette inutilisable dès le deuxième résultat.
 *
 * La liste des écrans vient de `src/app/screens.ts` (la même que le rail et la
 * barre du bas) : la palette ne porte plus sa propre copie des douze libellés.
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
import { SCREENS } from '../app/screens';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from './Sidebar';

/** Un geste que la palette peut lancer, en plus d'ouvrir un écran. */
export interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  t: TranslationDict;
  currentTheme: CurrentTheme;
  /** Le rôle du compte connecté — la palette ne montre que ce qu'il peut ouvrir. */
  role: string | null | undefined;
  onSelect: (tab: AppTab) => void;
  /** Les gestes du guichet (« encaisser », « ajouter un élève »). */
  actions?: PaletteAction[];
}

/** Comparaison insensible à la casse ET aux accents (« eleves » trouve « Élèves »). */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

interface Command {
  key: string;
  label: string;
  run: () => void;
  isAction: boolean;
}

export function CommandPalette({ open, onClose, t, currentTheme, role, onSelect, actions = [] }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, () => rootRef.current, '#command-palette-input');
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // La requête change la liste : le choix actif repart du premier, sinon il
  // désignerait une ligne qui n'existe plus.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const results = useMemo<Command[]>(() => {
    const needle = fold(query.trim());
    const screens: Command[] = SCREENS
      .filter((screen) => canOpenTab(screen.tab, role))
      .map((screen) => ({
        key: `screen:${screen.tab}`,
        label: String(t[screen.label]),
        run: () => onSelect(screen.tab),
        isAction: false,
      }));
    const gestures: Command[] = actions.map((action) => ({
      key: `action:${action.id}`,
      label: action.label,
      run: action.run,
      isAction: true,
    }));
    return [...screens, ...gestures].filter((command) => !needle || fold(command.label).includes(needle));
  }, [query, role, t, actions, onSelect]);

  if (!open) return null;

  const choose = (command: Command): void => {
    command.run();
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
      return;
    }
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      choose(results[Math.min(active, results.length - 1)]);
    }
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
          <Search size={16} className={currentTheme.muted} aria-hidden="true" />
          <input
            id="command-palette-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="command-palette-list"
            aria-activedescendant={results.length > 0 ? `command-palette-option-${Math.min(active, results.length - 1)}` : undefined}
            aria-autocomplete="list"
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
          <ul id="command-palette-list" role="listbox" aria-labelledby="command-palette-title" data-slot="command-palette-results" className="max-h-80 overflow-y-auto py-1">
            {results.map((command, index) => {
              const isActive = index === Math.min(active, results.length - 1);
              return (
                <li
                  key={command.key}
                  id={`command-palette-option-${index}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(command);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer text-left text-sm font-bold ${currentTheme.inkStrong} ${isActive ? currentTheme.hoverSurface : ''}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{command.label}</span>
                    {command.isAction && (
                      <span className={`shrink-0 text-3xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.actions}</span>
                    )}
                  </span>
                  <CornerDownLeft
                    size={12}
                    className={`${currentTheme.muted} ${isActive ? 'opacity-100' : 'opacity-0'}`}
                    aria-hidden="true"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
