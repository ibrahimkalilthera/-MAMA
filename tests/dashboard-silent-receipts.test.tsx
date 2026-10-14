/**
 * Le tableau de bord PUBLIE le rattrapage des reçus muets.
 *
 * Ce que ces cas tiennent, et pourquoi chacun peut casser en silence :
 *
 *   • **LE CHIFFRE EST CELUI DE L'ÉCRAN ÉCOLE** — la carte ne recompte rien :
 *     elle lit `silentReceiptsCatchUp(silentReceiptRows(...))`, la brique pure de
 *     l'onglet « Reçus muets ». Deux comptages séparés finiraient par diverger, et
 *     l'école lirait deux fois le même travail selon l'écran qu'elle ouvre ;
 *   • **L'ANCIENNETÉ SE LIT** — le plus ancien reçu muet de l'école, en jours,
 *     calculé depuis la date de référence de la vue (`today`, celle des retards) :
 *     c'est ce qui dit « depuis quand l'école attend », et un cas doit pouvoir la
 *     fixer plutôt que suivre l'horloge de la machine ;
 *   • **RIEN QUAND RIEN** — sans reçu muet, la carte dit qu'il n'y a rien à
 *     rattraper (le chiffre « 0 » se publie) ; sur une année ILLISIBLE, elle
 *     disparaît : annoncer « aucun reçu muet » là où l'application ne sait pas de
 *     quelle année elle parle serait une affirmation gratuite ;
 *   • **LE CLIC MÈNE À L'ÉCRAN** — la carte n'ouvre pas une fiche (c'est
 *     exactement ce que l'écran École évite : voir sans ouvrir) : elle renvoie à
 *     l'onglet qui liste et nomme les élèves.
 *
 * Tout se lit par les marqueurs `data-slot="dashboard-silent-receipts"` (avec
 * `data-receipts` et `data-oldest-days`), `-oldest` et `-open` — jamais par les
 * mots, qui changent avec la langue.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardView } from '../src/components/DashboardView';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { Payment, Student } from '../src/lib/domainTypes';
import type { TranslationDict } from '../src/i18n/translations';
import { translations } from '../src/i18n/translations';
import { installDomGlobals } from './harness';
import { makeProps, renderWithContext } from './views-harness';

installDomGlobals();

const t = translations.en as TranslationDict;

/** Le dictionnaire du harnais est celui des vues : les phrases mesurées sont les siennes. */
const reference = '2026-10-25';
const YEAR = '2026-2027';

/** Un reçu MUET : il ne déclare aucun mois. */
const silent = (id: string, date: string, amount: number): Payment => ({ id, date, amount });

/** Un reçu qui DÉCLARE ses mois : il n'a rien à faire dans un rattrapage. */
const declared = (id: string, date: string, amount: number, months: string[]): Payment =>
  ({ id, date, amount, months });

const student = (id: string, name: string, payments: Payment[], grade = '2A'): Student => ({
  id,
  name,
  grade,
  parentName: `Parent ${name}`,
  parentEmail: '',
  parentPhone: '',
  totalDue: 150000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  dueDate: '2027-06-30',
  notes: '',
  payments,
  academicYear: YEAR,
});

/** Deux élèves, trois reçus muets, le plus ancien chez le second. */
const withWork = (): Student[] => [
  student('st-1', 'Awa Traoré', [silent('p1', '2026-10-01', 30000), silent('p2', '2026-10-20', 5000)]),
  student('st-2', 'Ali Diallo', [silent('p3', '2026-09-10', 20000)]),
  student('st-3', 'Fanta Keïta', [declared('p4', '2026-09-15', 60000, ['2026-09'])]),
];

/**
 * La carte, depuis son marqueur — les phrases qu'elle porte ne sont employées par
 * aucune autre région du tableau de bord, donc ce qui suit le marqueur est bien
 * elle : son texte, sa ligne d'ancienneté et son bouton.
 */
const cardOf = (html: string) => {
  const start = html.indexOf('data-slot="dashboard-silent-receipts"');
  assert.ok(start >= 0, 'la carte des reçus muets doit être publiée sur le tableau de bord');
  return html.slice(start);
};

describe('DashboardView — le rattrapage des reçus muets, publié', () => {
  it('publie le nombre de reçus muets, les élèves concernés et l’ancienneté du plus ancien', () => {
    const html = renderWithContext(createElement(DashboardView), {
      students: withWork(),
      today: reference,
      selectedYear: YEAR,
    });

    const card = cardOf(html);
    assert.ok(card.includes('data-receipts="3"'), 'trois reçus muets, toutes lignes confondues');
    assert.ok(card.includes('data-oldest-days="45"'), '45 jours d’attente pour le plus ancien');
    assert.ok(
      card.includes(t.dashboardSilentReceiptsCount.replace('{count}', '3')),
      'le nombre de reçus est écrit',
    );
    assert.ok(
      card.includes(t.dashboardSilentReceiptsStudents.replace('{count}', '2')),
      'les familles concernées sont écrites aussi — un total nu ne dirait pas lesquelles',
    );
    assert.ok(
      card.includes(
        t.dashboardSilentReceiptsOldest.replace('{date}', '2026-09-10').replace('{days}', '45'),
      ),
      'le plus ancien reçu muet de l’école est daté, avec son ancienneté',
    );
    assert.ok(card.includes(t.dashboardSilentReceiptsOpen), 'la carte renvoie à l’écran qui liste');
    assert.ok(
      !card.includes(t.dashboardSilentReceiptsClear),
      'avec du travail, on n’annonce pas qu’il n’y en a pas',
    );
  });

  it('sans reçu muet : publie le zéro, sans inventer d’ancienneté ni de bouton', () => {
    const html = renderWithContext(createElement(DashboardView), {
      students: [student('st-1', 'Awa Traoré', [declared('p1', '2026-09-15', 60000, ['2026-09'])])],
      today: reference,
      selectedYear: YEAR,
    });

    const card = cardOf(html);
    assert.ok(card.includes('data-receipts="0"'), 'le chiffre se publie, même à zéro');
    assert.ok(card.includes('data-oldest-days=""'), 'pas de date, donc pas d’ancienneté');
    assert.ok(card.includes(t.dashboardSilentReceiptsClear), 'l’état vide est dit');
    assert.ok(!card.includes(t.dashboardSilentReceiptsOldest.split('{')[0]!.trim()), 'aucune ligne d’âge');
    assert.ok(!html.includes('dashboard-silent-receipts-open'), 'rien à rattraper : aucun bouton');
  });

  it('sur une année illisible, la carte disparaît au lieu d’annoncer « aucun reçu muet »', () => {
    const html = renderWithContext(createElement(DashboardView), {
      students: withWork(),
      today: reference,
      selectedYear: 'année inconnue',
    });

    assert.ok(!html.includes('data-slot="dashboard-silent-receipts"'),
      'pas de fenêtre, pas de jugement : le tableau de bord n’affirme rien');
  });

  it('le clic renvoie à l’onglet « Reçus muets » — il n’ouvre aucune fiche', async () => {
    const tabs: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(createElement(
        MainViewsContext.Provider,
        {
          value: makeProps({
            students: withWork(),
            today: reference,
            selectedYear: YEAR,
            setActiveTab: (tab: string) => { tabs.push(tab); },
          }),
        },
        createElement(DashboardView),
      ));
    });

    const button = container.querySelector('[data-slot="dashboard-silent-receipts-open"]');
    assert.ok(button, 'le bouton de rattrapage est monté');
    await act(async () => {
      (button as unknown as { click: () => void }).click();
    });
    assert.deepEqual(tabs, ['silentReceipts'], 'un clic = un onglet, et c’est celui qui liste');
    assert.equal(container.textContent?.includes(t.silentReceiptsOpen), false,
      'la carte n’offre pas « Ouvrir la fiche » : le rattrapage se voit sans ouvrir de fiche');

    await act(async () => root.unmount());
    container.remove();
  });
});
