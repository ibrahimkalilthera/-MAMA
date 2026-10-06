/**
 * Le TICKET DE RETARD DE PAIEMENT — l'avis remis aux parents qui règlent en
 * retard. Le propriétaire a demandé le 2026-10-06 que le MATRICULE de l'élève y
 * figure aussi, pour que la famille dispose de la même référence que sur le reçu
 * de paiement et le relevé de compte.
 *
 * Le composant porte DEUX copies du même document : l'aperçu à l'écran et le
 * jumeau imprimé (`hidden print:block`). Un papier remis aux parents qui ne
 * dirait pas la même chose que ce que le secrétariat a relu à l'écran serait un
 * piège, donc le cas mesure les DEUX — par le rendu réel (SSR) : le HTML produit
 * contient les deux blocs, et le matricule doit s'y trouver deux fois.
 *
 * Et la ligne n'existe QUE s'il y a un matricule : un libellé suivi d'un vide sur
 * un avis officiel est pire que pas de ligne du tout (fiche créée hors ligne,
 * matricule pas encore attribué).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
// `renderToStaticMarkup` (et non `renderToString`) : ce dernier intercale des
// marqueurs `<!-- -->` entre un texte et la valeur qui le suit, ce qui couperait
// « MATRICULE » de son « : » dans le HTML mesuré.
import { renderToStaticMarkup } from 'react-dom/server';
import { LatePaymentTicketModal } from '../src/components/LatePaymentTicketModal';
import { translations } from '../src/i18n/translations';
import type { Student } from '../src/lib/domainTypes';
import { makeProps } from './views-harness';

const baseStudent: Omit<Student, 'studentId'> = {
  id: 's1',
  name: 'Awa Traoré',
  grade: '9eme A',
  parentName: 'Djeneba Traoré',
  parentEmail: 'djeneba@example.com',
  parentPhone: '+223 70 00 00 00',
  totalDue: 150000,
  amountPaid: 50000,
  dueDate: '2026-09-30',
  payments: [],
  notes: '',
};

function renderTicket(lang: 'fr' | 'en', studentId?: string): string {
  return renderToStaticMarkup(
    createElement(LatePaymentTicketModal, {
      t: translations[lang],
      currentTheme: makeProps().currentTheme,
      student: { ...baseStudent, studentId },
      getGradeDisplay: (grade: string | undefined) => (grade ? `Classe ${grade}` : '—'),
      formatDate: (dateStr: string) => dateStr || '',
      formatCurrency: (amount: number) => `${amount} FCFA`,
      overlayRef: () => {},
      onClose: () => {},
    }),
  );
}

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe('ticket de retard — le matricule de l’élève', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`imprime le matricule sur les DEUX copies du ticket (${lang})`, () => {
      const html = renderTicket(lang, 'MT-2026-042');
      const label = `${translations[lang].studentId}:`;

      assert.equal(occurrences(html, label), 2, `le libellé doit être sur l’aperçu ET sur le jumeau imprimé (${label})`);
      assert.equal(occurrences(html, 'MT-2026-042'), 2, 'la valeur doit l’être aussi');
      // Le reste du ticket ne bouge pas : l'élève, le parent et le solde restent.
      assert.ok(html.includes('Awa Traoré'));
      assert.ok(html.includes('Djeneba Traoré'));
      assert.ok(html.includes('100000 FCFA'), 'le solde (150000 − 50000) reste affiché');
    });
  }

  it('n’imprime aucun libellé nu quand l’élève n’a pas encore de matricule', () => {
    const html = renderTicket('fr');
    assert.equal(occurrences(html, `${translations.fr.studentId}:`), 0, 'pas de ligne matricule sans matricule');
    assert.ok(html.includes('Awa Traoré'), 'le ticket reste complet');
    assert.ok(html.includes('100000 FCFA'));
  });

  it('n’imprime pas non plus une ligne vide pour un matricule blanc', () => {
    // Une valeur d'espaces ne doit pas passer pour un matricule : c'est le même
    // refus que partout ailleurs (`studentMatricule`).
    const html = renderTicket('fr', '   ');
    assert.equal(occurrences(html, `${translations.fr.studentId}:`), 0);
  });
});
