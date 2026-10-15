// Suite for Sidebar — « Historique des Paiements » lit comme ses voisines :
// un libellé à gauche, une ligne, la même hauteur que les autres.
//
// Le défaut était mesuré, pas deviné : au Geist 600/14 px, ce libellé fait
// 170,73 px ; le rail (256 px, moins 6 px de barre de défilement, moins les
// rembourrages) n'en offre que 163,28. Il passait donc à la ligne, la ligne
// grandissait de 20 px, et « Paramètres Système » comme « Productivité »
// descendaient d'un cran. Les autres libellés du rail tiennent tous (le plus
// long après lui : « Archives Annuelles », 128 px).
//
// Une suite happy-dom ne mesure pas de mise en page : ce qui se vérifie ici est
// donc le CONTRAT qui la produit, celui que la mesure a validé dans le navigateur
// — rembourrage gauche unique (c'est lui qui aligne les colonnes d'icônes et de
// libellés, et aucune ligne ne peut s'en écarter seule), libellé qui ne peut plus
// se replier (`truncate`), icône qui ne se laisse plus comprimer par le texte
// (elle mesurait 19,13 px au lieu de 20), et la place gagnée à droite,
// uniquement sur la ligne qui en a besoin.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { translations } from '../src/i18n/translations';
import { Sidebar } from '../src/components/Sidebar';
import type { CurrentTheme, PayrollWindowStatus } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800',
  accent: 'text-blue-600', accentBg: 'accent-surface', accentText: 'accent-surface-text',
  accentHover: 'accent-surface-hover', accentGroupHover: 'accent-group-hover', accentShadow: 'accent-shadow',
  accentSoft: 'accent-soft-surface', accentSoftText: 'accent-soft-text', accentSoftHover: 'accent-soft-hover',
  accentSoftTextHover: 'accent-soft-text-hover',
  accentHex: '#2563EB', accentHexDeep: '#1D4ED8', accentRing: 'accent-ring', inkStrong: 'text-slate-800',
  accentBorder: 'accent-border', accentBorderHover: 'accent-border-hover', surfaceInset: 'bg-slate-50',
  accentSoftDark: 'accent-soft-surface', accentSoftDarkHover: 'accent-soft-hover',
  accentSoftDarkText: 'accent-on-dark-text',
  tableHeader: 'bg-slate-50', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false,
  hoverSurface: 'state-hover',
  hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear',
  hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink',
  hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark',
  hoverAlertPlate: 'state-alert-plate',
};

const windowStatus = (): PayrollWindowStatus => ({
  currentDay: 5,
  currentCalendarYear: 2026,
  currentCalendarMonth: 8,
  totalPaidCurrentMonth: 0,
  isOverdue: false,
  isOpen: true,
});

describe('Sidebar — l’alignement des libellés du rail', () => {
  const win = installDomGlobals();

  /**
   * Le rail, tel qu'un dev le voit : sans badge vivant, pour que la seule chose
   * qui puisse faire varier une ligne soit son libellé.
   *
   * Le rôle est paramétrable, et il le FAUT depuis le 2026-10-15 : toutes les
   * lignes du rail ne s'adressent pas au même compte, et le cas qui mesure
   * l'économe doit le déclarer au lieu de mesurer le rail d'un dev.
   */
  async function renderSidebar(role: 'dev' | 'admin' | 'econome' | 'staff' = 'dev'): Promise<{ root: ReturnType<typeof createRoot>; container: Element }> {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(createElement(Sidebar, {
        t,
        schoolLogo: null,
        currentTheme: theme,
        activeTab: 'dashboard',
        setActiveTab: () => {},
        payrollWindowStatus: windowStatus(),
        currentUser: { username: 'ibrahim', role },
        fetchAuditLogs: () => {},
        showTodoSidebar: false,
        setShowTodoSidebar: () => {},
        onSignOut: () => {},
        onToggleLanguage: () => {},
        onAddStudent: () => {},
        onAddCr: () => {},
        onRecordPayment: () => {},
        auditArchivePending: false,
      }));
    });
    return { root, container: container as unknown as Element };
  }

  const itemsOf = (container: Element): HTMLButtonElement[] =>
    [...container.querySelectorAll('button.nav-item')] as HTMLButtonElement[];

  const labelOf = (item: HTMLButtonElement): HTMLSpanElement =>
    item.querySelector('span.font-semibold') as HTMLSpanElement;

  it('met tous les libellés dans la même colonne, à la même hauteur', async () => {
    const { root, container } = await renderSidebar();
    try {
      const items = itemsOf(container);
      assert.ok(items.length >= 11, `le rail porte ses ${items.length} entrées (dev compris)`);

      for (const item of items) {
        const label = labelOf(item);
        const classes = item.className;
        assert.ok(label, `chaque ligne porte un libellé — ${item.textContent}`);
        assert.ok(classes.includes('pl-4'), `le rembourrage gauche est écrit une fois, ici : ${item.textContent}`);
        assert.ok(!classes.includes('px-4'), `aucune ligne ne fixe son gauche en même temps que son droit : ${item.textContent}`);
        assert.ok(classes.includes('py-2.5'), `la hauteur d'une ligne ne se négocie pas : ${item.textContent}`);
        assert.ok(
          label.className.includes('font-semibold') && label.className.includes('text-sm'),
          `un seul type de libellé pour tout le rail : ${item.textContent}`,
        );
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('tient « Historique des Paiements » sur une ligne, sans toucher aux autres lignes', async () => {
    const { root, container } = await renderSidebar();
    try {
      const items = itemsOf(container);
      const history = items.find((item) => item.textContent?.includes(t.paymentHistory));
      assert.ok(history, 'l’historique des paiements est dans le rail');

      const label = labelOf(history);
      // `truncate` = jamais de seconde ligne : la ligne ne peut plus grandir, et
      // au pire le libellé se coupe — il ne casse plus la colonne.
      assert.ok(label.className.includes('truncate'), 'le libellé le plus long ne peut pas se replier');
      // L'icône garde ses 20 px : laissée compressible, c'est elle qui cédait les
      // pixels mesurés (19,13 px) et la colonne d'icônes devenait irrégulière.
      assert.ok(
        history.querySelector('svg')?.getAttribute('class')?.includes('flex-shrink-0'),
        'l’icône ne cède pas ses pixels au libellé',
      );
      assert.ok(history.className.includes('pr-1.5'), 'la ligne rend au libellé les pixels qu’il lui manquait');
      assert.ok(!history.className.includes('pr-4'), 'le rembourrage resserré remplace l’ancien, il ne s’y ajoute pas');
      // Le libellé entier reste lisible même s'il devait être tronqué un jour.
      assert.equal(history.getAttribute('title'), t.paymentHistory, 'le libellé entier reste accessible au survol');

      for (const item of items) {
        if (item === history) continue;
        assert.ok(item.className.includes('pr-4'), `les autres lignes gardent leur rembourrage : ${item.textContent}`);
        assert.ok(!item.className.includes('pr-1.5'), `le resserrement ne déborde pas d’une ligne : ${item.textContent}`);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('donne l’Historique des Paiements à l’ÉCONOME — et pas le journal ni les Réglages', async () => {
    // La mesure du 2026-10-15 : le propriétaire l'a constatée lui-même — « j'ai
    // vérifié et ça ne s'affiche pas ». La ligne était dans le bloc admin/dev du
    // rail ; elle en est sortie avec sa propre garde, celle de la base
    // (`public.is_payment_history_viewer()` : admin, dev, économe). L'économe tient
    // la caisse : c'est son écran. Le Journal d'audit, lui, reste fermé pour lui —
    // la policy ne lui rend que les gestes de caisse.
    const econome = await renderSidebar('econome');
    try {
      const labels = itemsOf(econome.container).map((item) => item.textContent ?? '');
      assert.ok(labels.some((label) => label.includes(t.paymentHistory)), 'la ligne de l’historique est dans le rail');
      assert.ok(!labels.some((label) => label.includes(t.auditTrail)), 'le Journal d’audit reste fermé à son compte');
      assert.ok(!labels.some((label) => label.includes(t.navSettings)), 'les Réglages aussi');
    } finally {
      await act(async () => econome.root.unmount());
      econome.container.remove();
    }

    // Le contrôle inverse, sur le même rail : un compte qui n'a AUCUN de ces
    // droits ne doit pas voir la ligne non plus — sinon la garde ne garderait rien.
    const staff = await renderSidebar('staff');
    try {
      const labels = itemsOf(staff.container).map((item) => item.textContent ?? '');
      assert.ok(!labels.some((label) => label.includes(t.paymentHistory)), 'rien de réservé pour un compte staff');
      assert.ok(!labels.some((label) => label.includes(t.auditTrail)), 'ni le journal');
    } finally {
      await act(async () => staff.root.unmount());
      staff.container.remove();
    }
  });
});
