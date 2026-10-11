/**
 * LA CARTE DU RAPPORT DE CAISSE, mesurée sur son rendu.
 *
 * Elle reçoit les lignes de la vue qui l'héberge (`rows`) et choisit sa journée :
 * ce que ce cas prouve, c'est la LIAISON — la carte affiche une ligne par caissier
 * avec le total encaissé, le total du jour, et les annulations de la journée ; elle
 * se désactive quand la journée choisie n'a rien encaissé ; et son champ de date
 * est celui du poste.
 *
 * ─── Ce que ce harnais ne sait PAS faire, et qui est donc mesuré ailleurs ─────
 * Changer la date depuis le DOM : sous React 19 + happy-dom, un `input` fabriqué
 * puis dispatché sur un champ CONTRÔLÉ n'atteint jamais `onChange` (mesuré — les
 * quatre variantes laissent l'état intact, alors qu'un `<select>` réagit). Le
 * champ est donc mesuré pour son CÂBLAGE (présent, nommé, à la journée du poste),
 * et le choix d'une journée pour son EFFET, dans `tests/daily-cash-report.test.ts`
 * sur le module pur.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { DailyCashReportCard } from '../src/components/DailyCashReportCard';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { localDayIso } from '../src/lib/dailyCashReport';
import { paymentHistoryRows } from '../src/lib/paymentHistory';
import type { PaymentHistoryRow } from '../src/lib/paymentHistory';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.fr as TranslationDict;
// La carte choisit sa journée sur le calendrier LOCAL du poste (`localDayIso`)
// et rien d'autre. Une journée FIGÉE dans ce harnais (un `'2026-10-06'` écrit à
// la main) ne vaudrait donc qu'un seul jour de l'année : le lendemain, la carte
// ouvrirait une journée vide et les quatre cas tomberaient — le contrôle
// accuserait le code pour la date de son exécution. Les gestes sont donc datés
// du jour du poste, et la « veille » du jour d'avant.
const DAY = localDayIso();
const PREVIOUS_DAY = localDayIso(new Date(Date.now() - 24 * 60 * 60 * 1000));

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};
const bob: Student = {
  id: 'st2', name: 'Bob Keïta', grade: '5A', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

const pay = (id: string, amount: number, receiptNumber: string): Payment => ({
  id, date: DAY, amount, academicYear: '2026-2027', receiptNumber,
});

const logs: AuditLogEntry[] = [
  {
    id: 'c1',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: alice.id,
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: `${DAY}T08:05:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-1)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('c1', 4000, 'REC-1'))),
  },
  {
    id: 'c2',
    action: 'DELETE_PAYMENT',
    targetId: 'c1',
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: `${DAY}T09:10:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-1) supprimé — élève Alice Traoré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('c1', 4000, 'REC-1'))),
  },
  {
    id: 'c3',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: bob.id,
    userName: 'Moussa Keïta',
    userEmail: 'moussa@mama.test',
    createdAt: `${DAY}T10:00:00Z`,
    details: 'Paiement de 6000 FCFA (reçu REC-2)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(bob.id, bob.name, pay('c3', 6000, 'REC-2'))),
  },
  {
    // Le geste sans caissier identifiable : sa ligne existe, sous le libellé de repli.
    id: 'c4',
    action: 'RECORD_PAYMENT',
    targetId: bob.id,
    createdAt: `${DAY}T11:00:00Z`,
    details: 'Paiement de 1000 FCFA (reçu REC-5)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(bob.id, bob.name, pay('c4', 1000, 'REC-5'))),
  },
  // La veille : elle ne doit pas entrer dans le rapport du jour.
  {
    id: 'c9',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: alice.id,
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    // Midi, et non 23 h 50 : dans un fuseau à l'est de Greenwich, un instant de
    // fin de soirée tomberait le LENDEMAIN — et la veille ne serait plus la veille.
    createdAt: `${PREVIOUS_DAY}T12:00:00Z`,
    details: 'Paiement de 99999 FCFA (reçu REC-9)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('c9', 99999, 'REC-9'))),
  },
];

const rows: PaymentHistoryRow[] = paymentHistoryRows({ logs, students: [alice, bob] });

function mount(cardRows: PaymentHistoryRow[] = rows) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(
      createElement(
        MainViewsContext.Provider,
        { value: makeProps({ t, lang: 'fr' }) },
        createElement(DailyCashReportCard, { rows: cardRows }),
      ),
    );
  });
  return {
    container,
    text: () => container.textContent ?? '',
    body: () => container.querySelector('tbody')?.textContent ?? '',
    dayField: () => container.querySelector<HTMLInputElement>(`input[aria-label="${t.dailyCashReportDay}"]`),
    exportButton: () => [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(t.exportPdf)),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('DailyCashReportCard — la caisse du jour, en un tableau', () => {
  it('montre une ligne par caissier, le total encaissé et le total du jour', () => {
    const h = mount();
    try {
      const text = h.text();
      assert.match(text, new RegExp(t.dailyCashReportTitle));
      assert.match(text, new RegExp(t.dailyCashReportCashier));
      assert.match(text, new RegExp(t.dailyCashReportCollected));
      assert.match(text, new RegExp(t.dailyCashReportCancelled));

      // Trois caissiers : Aggee, Moussa, et les gestes sans compte.
      assert.equal(h.container.querySelectorAll('tbody tr').length, 3, 'un caissier par ligne');
      const body = h.body();
      assert.match(body, /Aggee Diarra/);
      assert.match(body, /Moussa Keïta/);
      assert.ok(body.includes(t.roleStaff), 'un geste sans caissier est nommé au lieu d’être perdu');

      // Le total du jour suit les lignes : 4000 + 6000 + 1000 encaissés, 4000 annulés.
      assert.ok(
        text.includes(
          t.dailyCashReportTotals
            .replace('{count}', '4')
            .replace('{collected}', '11000 XOF')
            .replace('{cancelled}', '4000 XOF')
            .replace('{net}', '7000 XOF'),
        ),
        'la phrase du total du jour est écrite, et elle est celle des montants chiffrés',
      );
      assert.doesNotMatch(text, /99999/, 'le geste de la veille n’entre pas dans le rapport du jour');
    } finally {
      h.cleanup();
    }
  });

  it('liste les annulations du jour, avec l’élève, le reçu et le montant signé', () => {
    const h = mount();
    try {
      const text = h.text();
      assert.ok(text.includes(t.dailyCashReportCancellations.replace('{count}', '1')), 'le titre compte les annulations');
      assert.match(text, /REC-1/, 'le reçu annulé est lisible');
      assert.match(text, /Alice Traoré/, 'l’élève aussi');
      assert.match(text, /- 4000 XOF/, 'le montant annulé est signé');
      assert.match(text, /Aggee Diarra/, 'et l’annulation dit qui l’a faite');
      assert.doesNotMatch(text, new RegExp(t.dailyCashReportNoCancellations), 'il y a une annulation : pas de phrase vide');
    } finally {
      h.cleanup();
    }
  });

  it('dit qu’il n’y a rien à rapporter pour une journée sans geste', () => {
    // Aucune ligne du tout : quelle que soit la journée du poste, la journée
    // affichée est vide — le cas ne dépend donc pas du jour où il tourne.
    const h = mount([]);
    try {
      const text = h.text();
      assert.ok(text.includes(t.dailyCashReportEmpty), 'la journée vide le dit');
      assert.ok(text.includes(t.dailyCashReportNoCancellations), 'et l’absence d’annulation aussi');
      assert.equal(h.container.querySelectorAll('tbody tr').length, 1, 'une seule ligne : l’état vide');
      const button = h.exportButton();
      assert.ok(button, 'le bouton d’export est rendu');
      assert.equal(button.disabled, true, 'rien à rapporter : le bouton est désactivé, pas menteur');
    } finally {
      h.cleanup();
    }
  });

  it('câble son champ de journée sur le calendrier LOCAL du poste', () => {
    const h = mount();
    try {
      const field = h.dayField();
      assert.ok(field, 'le champ de journée est nommé (donc annoncé aux lecteurs d’écran)');
      assert.equal(field.getAttribute('type'), 'date');
      assert.equal(field.value, localDayIso(), 'la journée proposée est celle du poste, pas celle d’UTC');
      assert.equal(h.exportButton()?.disabled, false, 'avec des gestes, le rapport s’exporte');
    } finally {
      h.cleanup();
    }
  });
});
