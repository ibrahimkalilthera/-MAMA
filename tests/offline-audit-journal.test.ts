/**
 * Le journal d'audit VU DU POSTE — moitié cache, moitié file.
 *
 * Ce que ces tests protègent : ouvrir le journal sans réseau ne doit pas afficher
 * « l'école n'a rien fait », et une entrée pas encore en base ne doit JAMAIS se
 * lire comme une entrée en base (d'où le marqueur, vérifié ici).
 *
 * Module pur (aucun React, aucun Supabase) : le runner Node n'a pas de
 * localStorage, donc cette suite en pose un minimal — c'est le même stockage que
 * celui du navigateur, en mémoire.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_AUDIT_TAG,
  clearAuditJournalCache,
  pendingAuditEntries,
  readAuditJournalCache,
  writeAuditJournalCache,
} from '../src/lib/offlineAuditJournal';
import type { QueueItem } from '../src/lib/offlineQueue';
import { createRowId } from '../src/lib/rowMappers';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.clear();
});

function item<T extends QueueItem['type']>(
  type: T,
  payload: unknown,
  createdAt = '2026-09-14T10:00:00.000Z',
): QueueItem {
  return { id: `q_${type}_${createdAt}`, createdAt, attempts: 0, type, payload } as QueueItem;
}

const ACTOR = { id: 'u1', email: 'aggee@mamathera.org', full_name: 'Aggee Diarra', role: 'staff' };

describe('cache du journal (par compte)', () => {
  it('relit ce qu’il a écrit', () => {
    const entries = [
      { id: 'a1', userId: 'u1', userEmail: 'x@y.z', userName: 'X', userRole: 'staff', action: 'ADD_STUDENT', targetType: 'student', targetId: 's1', details: 'Sidi', createdAt: '2026-09-14T15:12:48.000Z' },
    ];
    writeAuditJournalCache('u1', entries);
    assert.deepEqual(readAuditJournalCache('u1'), entries);
  });

  it('ne rend JAMAIS le journal d’un autre compte (poste partagé)', () => {
    writeAuditJournalCache('u1', [
      { id: 'a1', userId: 'u1', userEmail: '', userName: '', userRole: '', action: 'ADD_STUDENT', targetType: '', targetId: '', details: 'privé', createdAt: '2026-09-14T15:12:48.000Z' },
    ]);
    assert.deepEqual(readAuditJournalCache('u2'), []);
  });

  it('sans cache, il n’y a pas de journal — et rien qui lève', () => {
    assert.deepEqual(readAuditJournalCache('inconnu'), []);
    assert.deepEqual(readAuditJournalCache(''), []);
  });

  it('le cache se nettoie (déconnexion d’un poste partagé)', () => {
    writeAuditJournalCache('u1', []);
    clearAuditJournalCache('u1');
    assert.deepEqual(readAuditJournalCache('u1'), []);
  });
});

describe('entrées en attente (dérivées de la file)', () => {
  it('reprend les gestes que le rejeu auditera, avec leur auteur et un marqueur', () => {
    const localId = createRowId();
    const queue = [
      item('addStudent', { name: 'Sidi COULIBALY' }),
      item('addAuditLog', {
        userId: 'u1', userEmail: 'aggee@mamathera.org', userName: 'Aggee Diarra', userRole: 'staff',
        action: 'UPDATE_SETTINGS', targetType: 'settings', targetId: null, details: 'thème sombre',
      }, '2026-09-14T11:00:00.000Z'),
    ];
    void localId;

    const pending = pendingAuditEntries(ACTOR, queue);
    assert.equal(pending.length, 2, 'chaque entrée que la file produira est montrée');

    const student = pending.find((e) => e.action === 'ADD_STUDENT');
    assert.ok(student);
    assert.equal((student.details ?? '').endsWith(PENDING_AUDIT_TAG), true, 'une entrée pas encore en base doit se voir');
    assert.equal(student.userEmail, 'aggee@mamathera.org', 'l’auteur de la station nomme le geste');
    assert.ok(student.id.startsWith('pending:'), 'un id distinct de ceux de la base');

    const settings = pending.find((e) => e.action === 'UPDATE_SETTINGS');
    assert.ok(settings);
    assert.equal(settings.details, `thème sombre${PENDING_AUDIT_TAG}`);
    assert.equal(settings.createdAt, '2026-09-14T11:00:00.000Z', 'la date du geste, pas celle du rejeu');
  });

  it('n’invente rien pour un geste qui n’est pas audité (tâche)', () => {
    assert.deepEqual(pendingAuditEntries(ACTOR, [item('addTodo', { text: 'Appeler', completed: false })]), []);
  });

  it('les plus récentes d’abord — le journal se lit du haut vers le bas', () => {
    const queue = [
      item('addStudent', { name: 'A' }, '2026-09-14T09:00:00.000Z'),
      item('addStudent', { name: 'B' }, '2026-09-14T17:00:00.000Z'),
    ];
    const pending = pendingAuditEntries(ACTOR, queue);
    assert.deepEqual(pending.map((e) => e.createdAt), ['2026-09-14T17:00:00.000Z', '2026-09-14T09:00:00.000Z']);
  });

  it('sans acteur connu, l’entrée existe quand même (jamais masquée)', () => {
    const pending = pendingAuditEntries(null, [item('addExpense', { category: 'other', description: 'd', amount: 1, date: '2026-09-14' })]);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].userEmail, '');
    assert.equal((pending[0].details ?? '').endsWith(PENDING_AUDIT_TAG), true);
  });
});
