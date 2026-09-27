// Suite PURE pour « une entrée saisie hors ligne » — pas de DOM, pas de PDF :
// la décision est mesurée là où elle est prise.
//
// Ce que ces cas verrouillent, et pourquoi chacun est là :
//   • « hors ligne » est un DRAPEAU (`recordedOffline`), jamais une déduction :
//     une entrée sans drapeau n'est pas marquée, même si ses champs ressemblent
//     à une date ancienne, et une entrée marquée sans date de geste ne produit
//     PAS de marque (colorer pour dire « à une date inconnue » n'apprend rien) ;
//   • les DEUX dates sortent ensemble — celle du geste, et celle de l'écriture —
//     et la seconde est OMISE quand on ne la connaît pas ;
//   • le PDF peint la ligne en rouge à partir de ce drapeau et de rien d'autre,
//     et la phrase qui accompagne la ligne porte les deux instants ;
//   • une ligne d'INCIDENT (postes bloqués regroupés) n'est jamais rougie par ce
//     chemin : son rouge à elle est celui d'une panne, pas d'une coupure.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isOfflineEntry, offlineOriginNote, offlineOriginOf } from '../src/lib/auditOffline';
import { auditPdfRowContent, OFFLINE_INK_RGB } from '../src/lib/pdfAuditJournal';
import { incidentRows } from '../src/lib/blockedIncidents';
import { translations } from '../src/i18n/translations';
import type { AuditLogEntry } from '../src/lib/auditLogger';

const t = translations.fr;

/** Le formateur du test : l'identité, pour relire les dates telles quelles. */
const id = (iso: string): string => iso;

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'e1',
    userEmail: 'admin@mamathera.org',
    userName: 'Admin Test',
    userRole: 'admin',
    action: 'RECORD_PAYMENT',
    details: 'Paiement de 80000 FCFA (reçu REC-1)',
    createdAt: '2026-09-27T22:50:00.000Z',
    ...overrides,
  };
}

/** Le geste du dimanche soir, écrit dans la base le lundi matin. */
const OFFLINE = entry({
  recordedOffline: true,
  createdAt: '2026-09-27T22:50:00.000Z',
  syncedAt: '2026-09-28T08:05:00.000Z',
});

describe('auditOffline — la marque', () => {
  it('ne marque QUE ce qui porte le drapeau', () => {
    assert.equal(offlineOriginOf(entry()), null, 'une entrée en ligne n’est pas marquée');
    assert.equal(isOfflineEntry(entry()), false);
    assert.equal(offlineOriginOf(null), null);
    assert.equal(offlineOriginOf(undefined), null);

    const mark = offlineOriginOf(OFFLINE);
    assert.deepEqual(mark, { capturedAt: '2026-09-27T22:50:00.000Z', syncedAt: '2026-09-28T08:05:00.000Z' });
    assert.equal(isOfflineEntry(OFFLINE), true);
  });

  it('ne marque pas une entrée sans instant de geste — une couleur sans date n’apprend rien', () => {
    assert.equal(offlineOriginOf(entry({ recordedOffline: true, createdAt: '' })), null);
  });

  it('dit les DEUX instants, et omet celui de l’écriture quand il est inconnu', () => {
    const labels = { captured: t.auditOfflineRowCaptured, synced: t.auditOfflineRowSynced };

    const both = offlineOriginNote(
      { capturedAt: '2026-09-27T22:50:00.000Z', syncedAt: '2026-09-28T08:05:00.000Z' },
      id,
      labels,
    );
    assert.ok(both.includes('2026-09-27T22:50:00.000Z'), 'l’instant du geste est écrit');
    assert.ok(both.includes('2026-09-28T08:05:00.000Z'), 'l’instant de l’écriture est écrit');
    assert.ok(both.includes(' · '), 'les deux fragments sont séparés, pas fondus');

    const capturedOnly = offlineOriginNote({ capturedAt: '2026-09-27T22:50:00.000Z', syncedAt: null }, id, labels);
    assert.ok(capturedOnly.includes('2026-09-27T22:50:00.000Z'));
    assert.ok(!capturedOnly.includes(' · '), 'sans date de synchronisation, aucune phrase creuse');
  });
});

describe('auditOffline — la ligne du PDF', () => {
  it('une entrée en ligne reste bleue et ne dit rien de la coupure', () => {
    const content = auditPdfRowContent({ kind: 'log', at: '', log: entry() }, t, 'fr', id);
    assert.equal(content.offline, null);
    assert.notDeepEqual(content.labelInk, OFFLINE_INK_RGB, 'le libellé n’est pas rouge');
    assert.notDeepEqual(content.timeInk, OFFLINE_INK_RGB, 'l’horodatage n’est pas rouge');
    assert.ok(!content.details.includes(t.auditOfflineRowCaptured), 'aucune mention d’origine');
  });

  it('une entrée hors ligne est ROUGE de bout en bout, et porte ses deux dates', () => {
    const content = auditPdfRowContent({ kind: 'log', at: '', log: OFFLINE }, t, 'fr', id);
    assert.ok(content.offline, 'la ligne se déclare hors ligne');
    assert.deepEqual(content.timeInk, OFFLINE_INK_RGB, 'horodatage rouge');
    assert.deepEqual(content.whoInk, OFFLINE_INK_RGB, 'acteur rouge');
    assert.deepEqual(content.labelInk, OFFLINE_INK_RGB, 'action rouge');
    assert.deepEqual(content.detailsInk, OFFLINE_INK_RGB, 'détail rouge');
    assert.ok(content.details.includes(t.auditOfflineRowCaptured.replace('{at}', '2026-09-27T22:50:00.000Z')));
    assert.ok(content.details.includes(t.auditOfflineRowSynced.replace('{at}', '2026-09-28T08:05:00.000Z')));
  });

  it('une ligne d’INCIDENT n’est pas rougie par ce chemin (son rouge dit une panne)', () => {
    const blocked: AuditLogEntry = {
      id: 'b1',
      action: 'poste bloqué — mise à jour obligatoire (install_failed)',
      details: 'poste PC-01 · motif : 404 · version 1.0.4 → 1.0.5',
      createdAt: '2026-09-27T08:00:00.000Z',
    };
    const rows = incidentRows([blocked]);
    assert.equal(rows[0].kind, 'incident', 'la remontée est bien regroupée en incident');
    const content = auditPdfRowContent(rows[0], t, 'fr', id);
    assert.equal(content.offline, null);
    assert.equal(content.whoCount, 1, 'un incident affiche un compte de postes, pas un acteur');
    assert.notDeepEqual(content.detailsInk, OFFLINE_INK_RGB);
  });
});
