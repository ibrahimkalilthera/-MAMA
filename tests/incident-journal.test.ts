/**
 * Le journal d'incidents existe pour qu'une panne chez l'école laisse une trace
 * exploitable SANS recopier les données de l'école. Les deux moitiés de cette
 * phrase sont testées ici : l'anneau est borné et lisible, et rien de nominatif
 * n'y entre.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_JOURNAL_MAX,
  clearIncidents,
  formatIncidentReport,
  installIncidentCapture,
  readIncidents,
  recordIncident,
  redactIncidentText,
  shortenIncidentWhere,
} from '../src/lib/incidentJournal';

type Listener = (event: Event) => void;

function fakeWindow() {
  const listeners = new Map<string, Set<Listener>>();
  const win = {
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as Window & typeof globalThis;
  return {
    win,
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

beforeEach(() => {
  clearIncidents();
});

describe('l’anneau est borné et le plus récent se lit en tête', () => {
  it('41 écritures → 40 lues, la dernière en premier', () => {
    for (let i = 1; i <= INCIDENT_JOURNAL_MAX + 1; i += 1) {
      recordIncident({
        kind: 'manual',
        error: new Error(`panne ${i}`),
        now: new Date(Date.UTC(2026, 10, 8, 10, 0, i)),
      });
    }
    const entries = readIncidents();
    assert.equal(entries.length, INCIDENT_JOURNAL_MAX, 'le plafond est une borne dure');
    assert.match(entries[0].message, /panne 41/, 'le plus récent est en tête');
    assert.ok(entries.every((entry) => entry.message !== 'panne 1'), 'le plus ancien est sorti');
  });

  it('une écriture refusée ne lève pas et ne ment pas', () => {
    const store = globalThis as { localStorage?: Storage };
    const original = store.localStorage;
    // Un stockage qui refuse tout : quota atteint, mode privé, disque plein.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        return {
          getItem: () => null,
          setItem: () => { throw new Error('QuotaExceededError'); },
          removeItem: () => {},
        };
      },
    });
    try {
      const written = recordIncident({ kind: 'manual', error: new Error('quota') });
      assert.equal(written, null, 'rien n’a été gardé, et le retour le dit');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => original });
    }
  });
});

describe('rien de nominatif n’est stocké', () => {
  it('téléphone, courriel, identifiant et requête d’URL sont masqués', () => {
    const text = redactIncidentText(
      'Élève Awa Traoré 123456789 injoignable — parent.awa@ecole.ml — voir https://exemple.test/app?token=abc123',
    );
    assert.doesNotMatch(text, /123456789/);
    assert.doesNotMatch(text, /parent\.awa@ecole\.ml/);
    assert.match(text, /\[courriel\]/);
    assert.match(text, /\?…/);
    assert.doesNotMatch(text, /abc123/);
    // Le message reste utile : on n'a pas effacé « injoignable ».
    assert.match(text, /injoignable/);
  });

  it('un message trop long est tronqué, une pile n’est jamais recopiée', () => {
    const error = new Error(`${'x'.repeat(400)}\n    at usePayments (src/app/usePayments.ts:290:12)`);
    const entry = recordIncident({ kind: 'boundary', error });
    assert.ok(entry);
    assert.ok(entry.message.length <= 180, `message de ${entry.message.length} caractères`);
    assert.doesNotMatch(entry.message, /at usePayments/, 'la pile ne voyage pas');
    // L'entrée n'a pas de champ pour la pile : elle ne peut pas la porter.
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'kind', 'message', 'name', 'where']);
  });

  it('l’emplacement est réduit au fichier et à la ligne', () => {
    assert.equal(
      shortenIncidentWhere('http://localhost/src/app/usePayments.ts:290:12'),
      'usePayments.ts:290',
    );
    assert.equal(shortenIncidentWhere(undefined), '');
  });
});

describe('la capture globale ne reste pas branchée', () => {
  it('capte une exception non attrapée puis une promesse rejetée, et se débranche', () => {
    const fake = fakeWindow();
    const off = installIncidentCapture(fake.win);

    fake.dispatch('error', {
      error: new TypeError('Cannot read properties of undefined'),
      filename: 'http://localhost/src/app/usePayments.ts',
      lineno: 290,
    });
    fake.dispatch('unhandledrejection', { reason: new Error('Échec réseau 50412') });

    const entries = readIncidents();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, 'rejection', 'le rejet est le plus récent');
    assert.equal(entries[1].kind, 'uncaught');
    assert.equal(entries[1].where, 'usePayments.ts:290');

    off();
    assert.equal(fake.count('error'), 0, 'le débranchement retire VRAIMENT l’écouteur');
    assert.equal(fake.count('unhandledrejection'), 0);
    fake.dispatch('error', { error: new Error('après débranchement') });
    assert.equal(readIncidents().length, 2, 'plus rien n’est noté après off()');
  });
});

describe('le rapport copiable tient debout tout seul', () => {
  it('porte la version, le poste et une ligne par incident, sans PII', () => {
    recordIncident({
      kind: 'uncaught',
      error: new Error('Reçu 123456789 introuvable pour awa@ecole.ml'),
      where: 'src/lib/pdfReceipt.ts:88:4',
      now: new Date('2026-11-08T10:00:00.000Z'),
    });
    const report = formatIncidentReport(readIncidents(), {
      appVersion: '1.0.43',
      station: 'K4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    assert.match(report, /version : 1\.0\.43 · poste : K4/);
    assert.match(report, /2026-11-08T10:00:00\.000Z · uncaught · Error/);
    assert.match(report, /pdfReceipt\.ts:88/);
    assert.doesNotMatch(report, /123456789/);
    assert.doesNotMatch(report, /awa@ecole\.ml/);
    assert.ok(report.split('\n').length >= 4, 'en-tête + compte + une ligne d’incident');
  });
});
