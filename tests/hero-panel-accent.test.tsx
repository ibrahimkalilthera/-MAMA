/**
 * L'accent de marque quitte DashboardView et ProductivityPanel.
 *
 * Les deux fichiers portaient `bg-blue-600` / `bg-emerald-500` codés en dur :
 * l'accent de marque y était écrit en clair, donc un thème dont l'accent n'est
 * pas ce bleu (ou ce vert) ne pouvait pas le rattraper — le remap `!important`
 * d'un thème sombre ne connaît que son propre accent. Ils portent maintenant
 * les jetons `currentTheme.accentBg/accentText/accentHover/accentGroupHover/
 * accentSoft/accentBorder…`, et la carte héros de DashboardView a perdu son
 * `--accent-primary` bleu codé en ligne (elle suit l'accent du thème).
 *
 * Le contrôle mesure le HTML RENDU, pas la source : c'est la classe réellement
 * émise qui décide si l'affordance suit le thème. La disparition des entrées de
 * dette dans `scripts/lib/theme-accents.mjs` est verrouillée par les gardes
 * d'accent ; ce cas verrouille ce que les gardes ne voient pas (l'accent en
 * ligne, et le câblage réel des jetons).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DashboardView } from '../src/components/DashboardView';
import { ProductivityPanel } from '../src/components/ProductivityPanel';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import type { TranslationDict } from '../src/i18n/translations';
import type { Todo } from '../src/lib/useSupabaseData';
import { translations } from '../src/i18n/translations';
import { makeProps, renderWithContext } from './views-harness';

const t = translations.en as TranslationDict;

/** Les jetons réels du thème (ceux de useTheme), pour lire une classe émise. */
const theme: CurrentTheme = {
  ...makeProps().currentTheme,
  accentBg: 'accent-surface',
  accentText: 'accent-surface-text',
  accentHover: 'accent-surface-hover',
  accentGroupHover: 'accent-group-hover',
  accentSoft: 'accent-soft-surface',
  accentSoftText: 'accent-soft-text',
  accentSoftDark: 'accent-soft-surface',
  accentSoftDarkText: 'accent-on-dark-text',
  accentBorder: 'accent-border',
  accentBorderHover: 'accent-border-hover',
  accentRing: 'accent-ring',
};

/** Surfaces d'accent interdites : elles fixeraient la couleur hors du thème. */
const HARDCODED = [
  'bg-blue-500',
  'bg-blue-600',
  'border-blue-600',
  'bg-sky-500',
  'ring-blue-500',
  'bg-emerald-500',
  'from-emerald-500',
  'border-emerald-500',
  '#3b82f6',
];

describe('DashboardView et ProductivityPanel portent leur accent sur le thème', () => {
  it('DashboardView n’émet plus de bleu/vert d’accent codé en dur', () => {
    const html = renderWithContext(createElement(DashboardView), { currentTheme: theme });
    for (const bad of HARDCODED) {
      assert.ok(!html.includes(bad), `accent codé en dur encore rendu : ${bad}`);
    }
    assert.ok(html.includes('accent-soft-surface'), 'la puce héros porte la surface d’accent');
    assert.ok(html.includes('accent-soft-text'), 'la puce héros porte l’encre d’accent');
    assert.ok(html.includes('accent-surface'), 'le point d’afflux et la barre portent l’accent');
  });

  it('ProductivityPanel : CTA, case cochée et poignée suivent les jetons', () => {
    const todos: Todo[] = [
      { id: 't1', text: 'Faire X', completed: true, date: '2026-01-15' },
      { id: 't2', text: 'Faire Y', completed: false },
    ];
    const html = renderToString(
      createElement(ProductivityPanel, {
        t,
        open: true,
        onClose: () => {},
        productivitySidebarTab: 'tasks',
        setProductivitySidebarTab: () => {},
        aiMessages: [],
        aiInput: '',
        setAiInput: () => {},
        handleAiQuery: () => {},
        todoInput: '',
        setTodoInput: () => {},
        todoDate: '2026-01-15',
        setTodoDate: () => {},
        handleAddTodo: () => {},
        todos,
        toggleTodo: () => {},
        deleteTodo: () => {},
        handleUpdateTodoDate: async () => true,
        currentTheme: theme,
      }),
    );
    for (const bad of HARDCODED) {
      assert.ok(!html.includes(bad), `accent codé en dur encore rendu : ${bad}`);
    }
    assert.ok(html.includes('accent-surface'), 'le CTA d’ajout porte l’accent');
    assert.ok(html.includes('accent-group-hover'), 'la poignée de redimensionnement porte le jeton groupe');
    assert.ok(html.includes('accent-soft-surface'), 'la puce de date porte la surface teintée');
  });
});
