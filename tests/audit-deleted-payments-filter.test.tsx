// Le filtre « Paiements supprimés » du journal d'audit.
//
// Le cas mesure l'INTERFACE, pas l'intention : l'option existe dans le menu
// d'actions, et la choisir ne laisse QUE les reçus annulés — leur ligne porte le
// montant, le reçu et l'élève. Deux témoins prouvent que le filtre trie vraiment :
// un enregistrement de paiement et une suppression d'élève doivent disparaître.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { AuditView } from '../src/components/AuditView';
import { translations } from '../src/i18n/translations';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.fr;

const DELETE_DETAILS = 'Paiement de 25000 FCFA (reçu REC-1) du 2026-10-01 supprimé — élève Ali Diallo';
const logs: AuditLogEntry[] = [
  { id: 'l1', action: 'DELETE_PAYMENT', userRole: 'admin', userName: 'Admin', createdAt: '2026-10-05T10:00:00Z', details: DELETE_DETAILS },
  { id: 'l2', action: 'RECORD_PAYMENT', userRole: 'admin', userName: 'Admin', createdAt: '2026-10-05T09:00:00Z', details: 'Paiement de 4000 FCFA (reçu REC-2)' },
  { id: 'l3', action: 'DELETE_STUDENT', userRole: 'admin', userName: 'Admin', createdAt: '2026-10-05T08:00:00Z', details: 'Élève Djenebou DIALLO supprimé' },
];

function mount() {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(
    createElement(
      MainViewsContext.Provider,
      { value: makeProps({ auditLogs: logs, t, lang: 'fr' }) },
      createElement(AuditView),
    ),
  ));
  const actionSelect = () => container.querySelector<HTMLSelectElement>(`select[aria-label="${t.auditFilterAction}"]`);
  return {
    container,
    actionSelect,
    change: (el: HTMLSelectElement, value: string) => act(() => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('AuditView — filtrer les reçus annulés', () => {
  it('propose l’option « Paiements supprimés »', () => {
    const h = mount();
    try {
      const select = h.actionSelect();
      assert.ok(select, 'le menu d’actions est rendu');
      const option = select.querySelector<HTMLOptionElement>('option[value="DELETE_PAYMENT"]');
      assert.ok(option, 'une option dédiée aux paiements supprimés existe');
      assert.equal(option.textContent, t.auditFilterDeletedPayments, 'et elle est libellée en clair');
    } finally {
      h.cleanup();
    }
  });

  it('choisir ce filtre ne laisse que les reçus annulés, avec montant, reçu et élève', () => {
    const h = mount();
    try {
      // Avant : les trois entrées sont visibles.
      assert.match(h.container.textContent ?? '', /Ali Diallo/, 'départ : la suppression de paiement est là');
      assert.match(h.container.textContent ?? '', /REC-2/, 'départ : l’enregistrement est là');

      h.change(h.actionSelect()!, 'DELETE_PAYMENT');

      const after = h.container.textContent ?? '';
      assert.match(after, /Ali Diallo/, 'l’élève concerné reste lisible');
      assert.match(after, /REC-1/, 'le reçu annulé reste lisible');
      assert.match(after, /25000|25 000/, 'le montant reste lisible');
      assert.doesNotMatch(after, /REC-2/, 'l’enregistrement de paiement est filtré');
      assert.doesNotMatch(after, /Djenebou DIALLO/, 'la suppression d’élève est filtrée elle aussi');
    } finally {
      h.cleanup();
    }
  });

  it('le groupe générique DELETE, lui, garde aussi la suppression d’élève', () => {
    const h = mount();
    try {
      h.change(h.actionSelect()!, 'DELETE');
      const after = h.container.textContent ?? '';
      assert.match(after, /REC-1/, 'la suppression de paiement reste');
      assert.match(after, /Djenebou DIALLO/, 'la suppression d’élève reste : c’est le groupe, pas le filtre dédié');
      assert.doesNotMatch(after, /REC-2/, 'l’enregistrement reste filtré');
    } finally {
      h.cleanup();
    }
  });
});
