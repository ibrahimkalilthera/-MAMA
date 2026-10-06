/**
 * L'historique des paiements, mesuré SUR LA VUE — pas sur son intention.
 *
 * Trois choses s'y prouvent, et chacune répond à une phrase de la demande :
 *   • « par qui » — le nom de l'utilisateur CONNECTÉ sort du journal, colonne
 *     ENCAISSÉ PAR ;
 *   • « quel montant » — un montant chiffré quand le geste porte son instantané ;
 *   • et l'honnêteté du reste : un geste d'avant la colonne n'a pas de montant
 *     chiffré, sa ligne le DIT et le résumé compte ces lignes au lieu de laisser
 *     croire à un total complet.
 *
 * La garde de rôle est mesurée elle aussi : le journal (`audit_logs`) n'est
 * lisible que par `admin`/`dev`, donc un autre rôle ne doit pas voir un écran
 * vide qui se lirait « l'école n'a rien encaissé ».
 *
 * ─── Ce que ce harnais ne sait PAS faire, et qui est donc mesuré ailleurs ─────
 * Une saisie au clavier ne peut pas être simulée ici : sous React 19 + happy-dom
 * 20, un `input` fabriqué puis dispatché sur un champ contrôlé n'atteint jamais
 * `onChange` (mesuré : les quatre variantes — accesseur du prototype, événement
 * du nœud ou global, `input` ou `change` — laissent l'état intact, alors qu'un
 * `<select>` réagit, lui, au même événement). Le champ de recherche est donc
 * mesuré pour son CÂBLAGE (présent, nommé, traduit), et la RECHERCHE elle-même
 * l'est dans `tests/payment-history.test.ts`, sur le module pur.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { PaymentHistoryView } from '../src/components/PaymentHistoryView';
import { translations } from '../src/i18n/translations';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { declaredDefaults, makeProps } from './views-harness';

const t = translations.fr;

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

const PAY: Payment = { id: 'pay1', date: '2026-10-02', amount: 4000, academicYear: '2026-2027', receiptNumber: 'REC-568556' };

const logs: AuditLogEntry[] = [
  {
    id: 'p1',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: '2026-10-02T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
  {
    // Le geste d'AVANT l'instantané structuré : montant seulement dans la phrase.
    id: 'p2',
    action: 'RECORD_PAYMENT',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    createdAt: '2026-09-20T09:00:00Z',
    details: 'Paiement de 6000 FCFA (reçu REC-0)',
  },
  {
    id: 'c1',
    action: 'DELETE_PAYMENT',
    targetId: 'pay1',
    userName: 'Moussa Keïta',
    createdAt: '2026-10-05T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556) du 2026-10-02 supprimé — élève Alice Traoré',
    // Une suppression porte son instantané (c'est ce qui la rend annulable) :
    // l'élève et le montant s'y relisent, malgré un `target_id` qui EST le
    // paiement — le seul geste dont `target_id` est l'élève est l'encaissement.
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
  // Un geste qui n'est PAS un paiement : il ne doit jamais apparaître ici.
  { id: 'x1', action: 'ADD_STUDENT', userName: 'Admin', createdAt: '2026-10-06T09:00:00Z', details: 'Fatou BOLLY' },
];

function mount(overrides: Parameters<typeof makeProps>[0] = {}) {
  const win = installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(
      createElement(
        MainViewsContext.Provider,
        { value: makeProps({ auditLogs: logs, students: [alice], t, lang: 'fr', ...overrides }) },
        createElement(PaymentHistoryView),
      ),
    );
  });
  return {
    container,
    text: () => container.textContent ?? '',
    /** Le corps du tableau SEUL : les menus de filtre contiennent aussi des libellés de gestes. */
    body: () => container.querySelector('tbody')?.textContent ?? '',
    select: () => container.querySelector<HTMLSelectElement>(`select[aria-label="${t.auditFilterAction}"]`),
    search: () => container.querySelector<HTMLInputElement>(`input[aria-label="${t.paymentHistorySearch}"]`),
    change: (el: HTMLSelectElement, value: string) => act(() => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('PaymentHistoryView — ce que la caisse relit', () => {
  it('montre l’élève, le montant chiffré et l’UTILISATEUR CONNECTÉ qui a encaissé', () => {
    const h = mount();
    try {
      const text = h.text();
      assert.match(text, /Alice Traoré/, 'l’élève est nommé');
      assert.match(text, /6B/, 'sa classe est lisible');
      assert.match(text, /4000 XOF/, 'le montant vient de l’instantané, pas de la phrase');
      assert.match(text, /REC-568556/, 'le reçu est lisible');
      assert.match(text, /Aggee Diarra/, 'l’encaisseur est nommé');
      assert.match(text, /aggee@mama.test/, 'et son compte est nommé');
      assert.match(text, /econome/, 'son rôle aussi');
      assert.match(h.body(), new RegExp(t.auditActionRecordPayment), 'le geste est libellé, pas le code');
      assert.match(h.body(), new RegExp(t.auditActionDeletePayment), 'l’annulation aussi');
      assert.doesNotMatch(text, /RECORD_PAYMENT|DELETE_PAYMENT/, 'aucun code brut à l’écran');
      assert.doesNotMatch(text, /Fatou BOLLY/, 'un geste qui n’est pas un paiement n’entre pas dans cet historique');
    } finally {
      h.cleanup();
    }
  });

  it('n’invente pas un montant pour un geste d’avant l’instantané, et le DIT', () => {
    const h = mount();
    try {
      const text = h.text();
      assert.match(text, new RegExp(t.paymentHistoryAmountInDetails), 'la colonne MONTANT renvoie au détail');
      assert.match(text, /6000 FCFA/, 'le montant reste lisible dans la phrase du journal');
      assert.match(text, /1 ligne/, 'le résumé compte la ligne qu’il ne peut pas additionner');
      assert.ok(
        text.includes(t.paymentHistoryWithoutAmount.replace('{count}', '1')),
        'la phrase qui dit ce que le net laisse de côté est écrite telle quelle',
      );
      // Le net ne porte que sur le montant chiffré : 4000 encaissé − 4000 annulé.
      // (Comparé par `includes` : la phrase contient des parenthèses littérales,
      // qui seraient interprétées comme un groupe si elle passait par un RegExp.)
      assert.ok(
        text.includes(t.paymentHistoryTotals
          .replace('{count}', '3')
          .replace('{collected}', '4000 XOF')
          .replace('{cancelled}', '4000 XOF')
          .replace('{net}', '0 XOF')),
        'le total est écrit, et il est celui des montants chiffrés',
      );
    } finally {
      h.cleanup();
    }
  });

  it('filtre par geste, et le résumé suit ce qui est affiché', () => {
    const h = mount();
    try {
      h.change(h.select()!, 'DELETE_PAYMENT');
      const cancelled = h.body();
      assert.match(cancelled, new RegExp(t.auditActionDeletePayment));
      assert.doesNotMatch(cancelled, new RegExp(t.auditActionRecordPayment), 'les encaissements sont filtrés');
      assert.match(cancelled, /Moussa Keïta/, 'l’auteur de l’annulation reste lisible');

      h.change(h.select()!, 'all');
      assert.match(h.body(), new RegExp(t.auditActionRecordPayment), 'revenir à « toutes les actions » rend les encaissements');
    } finally {
      h.cleanup();
    }
  });

  it('le champ de recherche est câblé au filtre (la saisie elle-même se mesure sur le module pur)', () => {
    const h = mount();
    try {
      const search = h.search();
      assert.ok(search, 'le champ de recherche est rendu');
      assert.equal(search.getAttribute('placeholder'), t.paymentHistorySearch, 'et il dit ce qu’il cherche');
      assert.equal(search.getAttribute('type'), 'search');
    } finally {
      h.cleanup();
    }
  });

  it('ne rend rien pour un rôle qui ne peut pas lire le journal', () => {
    const h = mount({ auth: { ...declaredDefaults.auth!, isAdmin: false } });
    try {
      assert.equal(h.text(), '', 'la policy RLS réserve audit_logs à admin/dev : pas d’écran vide qui se lirait « rien encaissé »');
      assert.equal(h.container.querySelectorAll('table').length, 0, 'aucun tableau n’est rendu');
    } finally {
      h.cleanup();
    }
  });
});
