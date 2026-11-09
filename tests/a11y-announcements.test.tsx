/**
 * CE QUE L'APP DIT À UN LECTEUR D'ÉCRAN — et ce qu'elle ne jette pas.
 *
 * Trois manques mesurés par l'audit, un cas chacun :
 *
 *   1. **Les toasts ne parlaient pas.** ~79 retours passent par le conteneur
 *      (« paiement enregistré », refus de la base, file d'attente) et aucun
 *      n'était annoncé : la seule région `aria-live` du dépôt vivait dans
 *      l'annonceur hors ligne. Le conteneur porte maintenant DEUX régions
 *      permanentes — `status` (poli) pour le reste, `alert` (assertif) pour
 *      l'erreur — et les cartes visibles n'ont AUCUN rôle, sinon le même fait
 *      serait annoncé deux fois.
 *   2. **Le ✕ des dialogues n'avait pas de nom** : `ModalShell` est le chrome de
 *      ~24 fenêtres, et un lecteur annonçait « bouton ».
 *   3. **Une saisie ne se jetait pas sur un clic à côté** : le fond, le ✕ et
 *      `Échap` ferment la fenêtre sans rien demander. Avec `isDirty`, ils
 *      DEMANDENT — et « continuer la saisie » reçoit le focus.
 *
 * Le tri clavier (`aria-sort`, bouton DANS le `<th>`) est mesuré sur le HTML
 * rendu d'`StudentsView`, parce que c'est là que le `<th>` cliquable vivait.
 * Il l'est aussi sur les DEUX tables de Dépenses et sur le registre de la Paie,
 * qui n'avaient aucun tri (ni souris ni clavier) ; et le clic est exercé une
 * fois pour de vrai, parce qu'un `aria-sort` qui change sans que les lignes
 * bougent annoncerait un ordre que l'écran n'applique pas. Le sélecteur de tri
 * des Parents, lui, est fait de vrais boutons : son état ACTIF doit être dit
 * autrement que par la couleur (`aria-pressed`).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { installDomGlobals } from './harness';

const win = installDomGlobals();

const { ToastContainer } = await import('../src/components/ToastNotification');
const { ModalShell } = await import('../src/components/ModalShell');
const { StudentsView } = await import('../src/components/StudentsView');
const { translations } = await import('../src/i18n/translations');
const { makeProps, renderWithContext } = await import('./views-harness');
const { MainViewsContext } = await import('../src/app/mainViewsContext');
const { ExpensesView } = await import('../src/components/ExpensesView');
const { PayrollView } = await import('../src/components/PayrollView');
const { ParentsView } = await import('../src/components/ParentsView');
const { createElement: h } = await import('react');

const t = translations.fr as unknown as Record<string, string>;
// Le harnais des vues déclare le dictionnaire ANGLAIS : les cas qui cherchent un
// libellé dans le HTML rendu par `renderWithContext` doivent le chercher là.
const en = translations.en as unknown as Record<string, string>;

const theme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800', accent: 'text-emerald-600',
  accentBg: 'bg-emerald-50', accentText: 'text-white', accentHover: 'hover:bg-emerald-100',
  accentGroupHover: 'accent-group-hover', accentShadow: 'shadow-emerald-200', accentSoft: 'bg-emerald-50',
  accentSoftText: 'text-emerald-600', accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669', accentHexDeep: '#047857', accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300', accentBorderHover: 'hover:border-slate-400', surfaceInset: 'bg-slate-50',
  inkStrong: 'text-slate-800', accentSoftDark: 'bg-blue-500/15', accentSoftDarkHover: 'hover:bg-blue-500/25',
  accentSoftDarkText: 'text-blue-300', tableHeader: 'bg-slate-100', rowHover: 'hover:bg-slate-50',
  hoverSurface: 'state-hover', hoverSurfaceSolid: 'state-hover-solid', hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark', hoverSurfaceClear: 'state-hover-clear', hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink', hoverAlert: 'state-alert-hover', hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid', hoverAlertDark: 'state-alert-dark', hoverAlertPlate: 'state-alert-plate',
  input: 'bg-white', isDark: false,
};

function toast(id: string, type: 'success' | 'error', message: string) {
  return { id, type, message, title: message };
}

/**
 * Un en-tête triable se lit SANS souris : `<th aria-sort>` + `<button>`.
 *
 * `total` est le nombre d'en-têtes triables ATTENDUS dans la table — le dire
 * évite qu'un tableau qui n'en rendrait plus qu'un seul (une régression qui
 * laisserait passer le cas) compte comme triable.
 */
function assertSortableTable(html: string, what: string, total: number) {
  const headers = [...html.matchAll(/<th aria-sort="([^"]+)"[^>]*>([\s\S]*?)<\/th>/g)];
  assert.equal(headers.length, total, `${what} : ${total} en-tête(s) triable(s)`);
  for (const [, sort, inner] of headers) {
    assert.ok(
      sort === 'ascending' || sort === 'descending' || sort === 'none',
      `${what} : aria-sort porte une valeur valide (reçu « ${sort} »)`
    );
    assert.ok(inner.includes('<button'), `${what} : chaque en-tête triable est un BOUTON — donc il se clique au clavier`);
  }
  assert.ok(!/<th[^>]*onClick/.test(html), `${what} : aucun en-tête cliquable à la souris seule`);
}

describe('ce que l’app ANNONCE', () => {
  it('un toast ordinaire part sur la région POLIE, et une seule fois', () => {
    const html = renderToStaticMarkup(
      createElement(ToastContainer, {
        toasts: [toast('a', 'success', 'Paiement enregistré')] as never,
        onDismiss: () => {},
      })
    );
    assert.match(html, /role="status"[^>]*aria-live="polite"/, 'la région polie existe');
    assert.match(html, /Paiement enregistré/, 'et elle porte le message');
    // La région ASSERTIVE est montée en permanence (une région qui naît avec son
    // texte n'est annoncée par aucun lecteur) : elle doit donc exister VIDE.
    const assertive = html.match(/data-slot="toast-announcer-alert"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(assertive, 'la région assertive est montée');
    assert.equal(assertive[1], '', 'et elle n’annonce RIEN pour une réussite');
  });

  it('une ERREUR part sur la région ASSERTIVE (elle interrompt)', () => {
    const html = renderToStaticMarkup(
      createElement(ToastContainer, {
        toasts: [toast('b', 'error', 'La base a refusé')] as never,
        onDismiss: () => {},
      })
    );
    assert.match(html, /role="alert"[^>]*aria-live="assertive"/);
    assert.match(html, /La base a refusé/);
  });

  it('les régions sont montées MÊME SANS toast (une région qui naît avec son texte n’est pas annoncée)', () => {
    const html = renderToStaticMarkup(
      createElement(ToastContainer, { toasts: [] as never, onDismiss: () => {} })
    );
    assert.match(html, /data-slot="toast-announcer-status"/);
    assert.match(html, /data-slot="toast-announcer-alert"/);
  });

  it('le ✕ d’un dialogue a un NOM, et la saisie modifiée DEMANDE avant de partir', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let closed = 0;
    act(() => {
      root.render(
        createElement(ModalShell, {
          overlayRef: () => {},
          onClose: () => { closed += 1; },
          currentTheme: theme as never,
          titleId: 'a11y-title',
          ariaLabel: 'Encaissement',
          title: 'Encaissement',
          closeLabel: t.close,
          isDirty: true,
          discardTitle: 'Abandonner la saisie ?',
          discardMessage: 'Ce qui est tapé sera perdu.',
          discardConfirmLabel: 'Abandonner',
          discardCancelLabel: 'Continuer',
          children: createElement('p', null, 'corps'),
        })
      );
    });

    const close = container.querySelector('[data-modal-close]') as HTMLButtonElement | null;
    assert.ok(close, 'le ✕ est rendu');
    assert.equal(close.getAttribute('aria-label'), t.close, 'il est nommé');
    assert.ok(close.getAttribute('title'), 'et infobulle');

    act(() => { close.click(); });
    assert.equal(closed, 0, 'un clic sur ✕ ne jette pas la saisie');
    const asking = container.querySelector('[data-slot="modal-discard-confirm"]');
    assert.ok(asking, 'la demande s’affiche dans la fenêtre');
    assert.equal(asking.getAttribute('role'), 'alertdialog');
    assert.match(container.textContent ?? '', /Abandonner la saisie/);

    const keep = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continuer');
    assert.ok(keep, '« continuer » est offert');
    assert.equal(document.activeElement, keep, 'et il a le focus — une touche Entrée réflexe ne confirme pas la perte');

    act(() => { root.unmount(); });
    container.remove();
  });

  it('sans saisie modifiée, ✕ ferme tout de suite (pas de demande inutile)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let closed = 0;
    act(() => {
      root.render(
        createElement(ModalShell, {
          overlayRef: () => {}, onClose: () => { closed += 1; }, currentTheme: theme as never,
          titleId: 'a11y-title2', ariaLabel: 'Vide', title: 'Vide', closeLabel: t.close,
          children: null,
        })
      );
    });
    const close = container.querySelector('[data-modal-close]') as HTMLButtonElement;
    act(() => { close.click(); });
    assert.equal(closed, 1);
    assert.equal(container.querySelector('[data-slot="modal-discard-confirm"]') === null, true, 'aucune demande quand rien n’est modifié');
    act(() => { root.unmount(); });
    container.remove();
  });

  it('le tri des élèves est un BOUTON dans le <th>, et l’ordre est ANNONCÉ', () => {
    const html = renderWithContext(h(StudentsView));
    assert.match(html, /aria-sort="(ascending|descending|none)"/, 'la colonne active porte son ordre');
    const th = html.match(/<th aria-sort="[^"]+"[^>]*>[\s\S]{0,400}?<\/th>/);
    assert.ok(th, 'un <th> triable est rendu');
    assert.ok(th[0].includes('<button'), 'il contient un bouton — donc il se clique au clavier');
    assert.ok(!/<th[^>]*onClick/.test(html), 'aucun en-tête cliquable à la souris seule');
  });

  it('les DEUX tables de Dépenses se trient au clavier et annoncent leur ordre', () => {
    // Dépenses n'avait AUCUN tri : ni `<th onClick>` à convertir, ni bouton. Les
    // quatre colonnes du registre général et les six du registre fournisseur en
    // portent un maintenant, et la colonne d'actions reste un `<th>` simple.
    const general = renderWithContext(h(ExpensesView), { vendorExpensesTab: 'general' });
    assertSortableTable(general, 'dépenses générales', 4);

    const vendors = renderWithContext(h(ExpensesView), { vendorExpensesTab: 'vendors' });
    assertSortableTable(vendors, 'dépenses fournisseurs', 6);
  });

  it('le registre de la PAIE se trie au clavier, sur le NOM et non sur l’identifiant', () => {
    const html = renderWithContext(h(PayrollView));
    assertSortableTable(html, 'registre de la paie', 3);
  });

  it('cliquer un en-tête TRIE réellement les lignes, et le second clic inverse', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = makeProps({
      vendorExpensesTab: 'general',
      generalExpenseCategoryFilter: 'all',
      generalExpenseSearch: '',
      selectedYear: '',
      // Dates volontairement INVERSE de l'ordre alphabétique : le tri par défaut
      // (date décroissante) met « Gros achat » d'abord, le clic sur « Montant »
      // en croissant doit mettre « Petit achat » d'abord. Si les deux ordres
      // coïncidaient, le cas passerait sans que rien ne trie.
      expenses: [
        { id: 'e1', category: 'Other', description: 'Petit achat', amount: 100, date: '2026-02-01' },
        { id: 'e2', category: 'Other', description: 'Gros achat', amount: 900, date: '2026-02-02' },
      ] as never,
    });
    act(() => {
      root.render(h(MainViewsContext.Provider, { value: props }, h(ExpensesView)));
    });

    const table = Array.from(container.querySelectorAll('table')).find((tb) => tb.querySelector('th[aria-sort]'));
    assert.ok(table, 'une table triable est rendue');
    const firstRow = () => table!.querySelectorAll('tbody tr')[0]?.textContent ?? '';
    assert.match(firstRow(), /Gros achat/, 'ordre par défaut : la date la plus récente d’abord');

    const amountHeader = Array.from(table!.querySelectorAll('th[aria-sort]')).find((th) =>
      (th.textContent ?? '').includes(en.amount)
    );
    assert.ok(amountHeader, 'l’en-tête « Montant » est rendu');
    const amountButton = amountHeader!.querySelector('button');
    assert.ok(amountButton, 'et il porte un bouton');

    act(() => { amountButton!.click(); });
    assert.equal(amountHeader!.getAttribute('aria-sort'), 'ascending', 'le premier clic annonce l’ordre croissant');
    assert.match(firstRow(), /Petit achat/, 'et les lignes suivent : 100 avant 900');

    act(() => { amountButton!.click(); });
    assert.equal(amountHeader!.getAttribute('aria-sort'), 'descending', 'le second clic inverse');
    assert.match(firstRow(), /Gros achat/, 'et les lignes suivent : 900 avant 100');

    act(() => { root.unmount(); });
    container.remove();
  });

  it('le sélecteur de tri des Parents dit son état ACTIF, pas seulement par la couleur', () => {
    const parent = {
      id: 'p1', fullName: 'Awa Diop', phones: ['+221770000000'], address: 'Dakar',
      occupation: 'Commerçante', relationship: 'Mother', linkedStudentIds: ['s1', 's2'],
    };
    const child = (id: string, name: string, totalDue: number, amountPaid: number) => ({
      id, studentId: id, name, grade: 'CP', totalDue, amountPaid,
    });
    const html = renderWithContext(h(ParentsView), {
      parents: [parent] as never,
      expandedParentId: 'p1',
      parentChildrenSortBy: 'alphabetical',
      getChildrenForParent: (() => [child('s1', 'Bineta', 500, 0), child('s2', 'Cheikh', 500, 500)]) as never,
      getParentOutstandingBalance: (() => 500) as never,
      getParentPaymentHistory: (() => []) as never,
    });

    const pressed = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"/g)].map((m) => m[1]);
    assert.equal(pressed.length, 2, 'les deux choix de tri disent leur état');
    assert.equal(pressed.filter((p) => p === 'true').length, 1, 'un seul est ACTIF');
    assert.equal(pressed.filter((p) => p === 'false').length, 1, 'l’autre est explicitement inactif');
  });
});

afterEach(() => {
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
});
