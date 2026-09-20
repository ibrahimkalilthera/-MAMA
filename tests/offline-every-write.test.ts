/**
 * « TOUTES les fonctionnalités fonctionnent hors ligne » — les ÉCRITURES qui
 * restaient en ligne.
 *
 * Ce que cette suite verrouille, et pourquoi chacune compte :
 *
 *   • classes personnalisées (créer / modifier / supprimer) — un poste sans
 *     réseau ne pouvait pas ajouter la classe d'une rentrée ;
 *   • notes du calendrier — `saveCalendarDayNote` rendait `null` hors ligne, donc
 *     le geste était fermé en laissant croire à un échec ;
 *   • déclaration de l'année courante — elle était simplement abandonnée, et
 *     personne ne décidait pour le parc avant le retour de la ligne ET un
 *     redémarrage ;
 *   • journal d'audit — un geste fait sans réseau n'était pas seulement non
 *     enregistré : il était attribué à « System Staff », y compris une fois la
 *     ligne revenue (un acteur introuvable était mémorisé pour toute la page).
 *
 * supabaseClient est simulé AVANT l'import (comme tests/calendar-notes-db.test.ts) :
 * le vrai client ne se charge pas sous le runner (pas d'import.meta.env). Le
 * nombre d'appels au faux client est compté : hors ligne, il doit rester à ZÉRO —
 * c'est ce qui distingue « mis en file » de « tenté puis perdu ».
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
import { clearOfflineQueue, enqueueOfflineAction, getOfflineQueue } from '../src/lib/offlineQueue';
import { setOfflineSessionActive } from '../src/lib/networkUtils';
import type { CustomClass } from '../src/lib/domainTypes';

// ─── Un localStorage minimal (le runner n'en a pas) ──────────────────────────
// Il sert à deux choses : la file hors ligne quand elle préfère le stockage, et
// le cache des années scolaires (que la station relit sans réseau).

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

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });

// ─── Le faux client Supabase ─────────────────────────────────────────────────

interface Call {
  op: 'insert' | 'update' | 'delete' | 'select';
  table: string;
  payload?: Record<string, unknown>;
}

interface Result {
  data: unknown;
  error: unknown;
}

let calls: Call[] = [];
let rowsResult: Result = { data: null, error: null };
let writeResult: Result = { data: [{ id: 'db-1' }], error: null };
let authUser: { id: string; email: string; user_metadata?: { full_name?: string } } | null = null;
let authThrows = false;

interface Chain extends PromiseLike<Result> {
  eq: (column: string, value: unknown) => Chain;
  neq: (column: string, value: unknown) => Chain;
  select: (columns?: string) => Chain;
  order: () => Chain;
  limit: () => Chain;
  single: () => Promise<Result>;
  maybeSingle: () => Promise<Result>;
}

function chain(resolveWith: () => Result): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    eq: () => api,
    neq: () => api,
    select: () => api,
    order: () => api,
    limit: () => api,
    single: () => Promise.resolve().then(resolveWith),
    maybeSingle: () => Promise.resolve().then(resolveWith),
    then: promise.then.bind(promise),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  auth: {
    getUser: async () => {
      if (authThrows) throw new TypeError('Failed to fetch');
      return { data: { user: authUser } };
    },
  },
  from: (table: string) => ({
    select: () => {
      calls.push({ op: 'select', table });
      return chain(() => rowsResult);
    },
    insert: (payload: Record<string, unknown>) => {
      calls.push({ op: 'insert', table, payload });
      return chain(() => writeResult);
    },
    update: (payload: Record<string, unknown>) => {
      calls.push({ op: 'update', table, payload });
      return chain(() => writeResult);
    },
    delete: () => {
      calls.push({ op: 'delete', table });
      return chain(() => writeResult);
    },
  }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { createClassOps } = await import('../src/lib/dataOps/classes');
const { saveCalendarDayNote, deleteCalendarDayNote } = await import('../src/lib/calendarNotes');
const { keepAcademicYearCurrent, fetchAcademicYears } = await import('../src/lib/dataOps/academicYears');
const { logAuditEvent, setAuditActor } = await import('../src/lib/auditLogger');

// ─── Utilitaires ─────────────────────────────────────────────────────────────

beforeEach(() => {
  calls = [];
  rowsResult = { data: null, error: null };
  writeResult = { data: [{ id: 'db-1' }], error: null };
  authUser = null;
  authThrows = false;
  memoryStorage.clear();
  clearOfflineQueue();
  setOfflineSessionActive(false);
  setAuditActor(null);
});

/** Les opérations de classes, avec un état local réel et la file réelle. */
function classOps(initial: CustomClass[] = []) {
  let current = [...initial];
  const events: string[] = [];
  const ctx = {
    students: [], staff: [], parents: [], vendorExpenses: [], expenses: [],
    setParents: () => {}, setStudents: () => {}, setStaff: () => {},
    setSalaryPayments: () => {}, setExpenses: () => {}, setVendorExpenses: () => {}, setTodos: () => {},
    setCustomClasses: (next: CustomClass[] | ((prev: CustomClass[]) => CustomClass[])) => {
      current = typeof next === 'function' ? next(current) : next;
    },
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => true,
    // La file RÉELLE : c'est elle que le rejeu lira, donc ce que ces tests
    // vérifient est exactement ce que le transfert enverra.
    enqueueOffline: (type: string, payload: unknown, localId?: string) => {
      enqueueOfflineAction(
        type as Parameters<typeof enqueueOfflineAction>[0],
        payload as Parameters<typeof enqueueOfflineAction>[1],
        localId,
      );
    },
  };
  return {
    ops: createClassOps(ctx as unknown as Parameters<typeof createClassOps>[0]),
    events,
    state: () => current,
  };
}

const FOURTH = { code: '4A', cycle: 'cycle1' as const, year: '4', section: 'A', nameFr: '4e A', nameEn: '4th A' };

describe('classes personnalisées hors ligne', () => {
  it('créer une classe sans réseau : elle est visible, en file, et garde son identifiant', async () => {
    const { ops, state, events } = classOps();
    const created = await ops.addCustomClass(FOURTH);

    assert.ok(created, 'la classe est rendue à l’appelant (le formulaire se ferme)');
    assert.deepEqual(state().map(c => c.id), ['4A']);
    assert.deepEqual(events, ['ok:addCustomClass']);
    assert.equal(calls.length, 0, 'aucune requête ne part sans réseau');

    const queue = getOfflineQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'addClass');
    assert.equal(queue[0].localId, created.rowId, 'l’id choisi sur le poste est celui que la base recevra');
    assert.equal(queue[0].payload.code, '4A');
  });

  it('modifier une classe sans réseau : le changement est en file', async () => {
    const existing: CustomClass = { id: '4A', rowId: 'row-4a', cycle: 'cycle1', year: '4', section: 'A', nameFr: '4e A', nameEn: '4th A', isCustom: true };
    const { ops, state } = classOps([existing]);

    assert.equal(await ops.updateCustomClass('row-4a', { ...FOURTH, code: '4B', section: 'B' }), true);
    assert.equal(state()[0].id, '4B');
    assert.equal(calls.length, 0);
    const queued = getOfflineQueue()[0];
    assert.equal(queued.type, 'updateClass');
    assert.equal(queued.payload.id, 'row-4a');
    assert.equal(queued.payload.updates.code, '4B');
  });

  it('supprimer une classe sans réseau : elle disparaît de l’écran et part en file', async () => {
    const existing: CustomClass = { id: '4A', rowId: 'row-4a', cycle: 'cycle1', year: '4', section: 'A', nameFr: '4e A', nameEn: '4th A', isCustom: true };
    const { ops, state } = classOps([existing]);

    assert.equal(await ops.deleteCustomClass('row-4a'), true);
    assert.deepEqual(state(), []);
    assert.equal(calls.length, 0);
    assert.deepEqual(getOfflineQueue()[0].payload, { id: 'row-4a' });
  });
});

describe('notes du calendrier hors ligne', () => {
  it('une note ajoutée sans réseau existe à l’écran et part en file', async () => {
    setOfflineSessionActive(true);
    const saved = await saveCalendarDayNote('2026-09-03', 'Paiement Mme Diallo');

    assert.ok(saved, 'la note est rendue (le modal se vide, l’utilisateur voit qu’elle est prise)');
    assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i, 'un vrai UUID, celui que la colonne acceptera');
    assert.equal(calls.length, 0);

    const queued = getOfflineQueue()[0];
    assert.equal(queued.type, 'addNote');
    assert.equal(queued.localId, saved.id, 'la note garde son identité jusqu’en base');
    assert.equal(queued.payload.date, '2026-09-03');
    assert.equal(queued.payload.text, 'Paiement Mme Diallo');
  });

  it('la suppression d’une note part en file, sans toucher à la base', async () => {
    setOfflineSessionActive(true);
    assert.equal(await deleteCalendarDayNote('n1'), true);
    assert.equal(calls.length, 0);
    assert.deepEqual(getOfflineQueue()[0], { ...getOfflineQueue()[0], type: 'deleteNote', payload: { id: 'n1' } });
  });

  it('la ligne revenue, la même note part en base avec son identifiant', async () => {
    setOfflineSessionActive(true);
    const saved = await saveCalendarDayNote('2026-09-04', 'Réunion');
    setOfflineSessionActive(false);
    rowsResult = { data: [{ id: saved!.id, note_date: '2026-09-04', text: 'Réunion' }], error: null };

    const online = await saveCalendarDayNote('2026-09-04', 'Réunion');
    assert.ok(online);
    assert.equal(calls.filter(c => c.op === 'insert').length, 1, 'en ligne, c’est la base qui répond');
  });
});

describe('déclaration de l’année courante hors ligne', () => {
  it('sans réseau, la déclaration est mise en file au lieu d’être abandonnée', async () => {
    setOfflineSessionActive(true);
    assert.equal(await keepAcademicYearCurrent('2027-2028'), true);
    assert.equal(calls.length, 0, 'rien ne part tant que la ligne est coupée');

    const queue = getOfflineQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'setCurrentYear');
    assert.equal(queue[0].payload.year, '2027-2028');
  });

  it('un poste redémarré dix fois hors ligne n’empile pas dix fois la même déclaration', async () => {
    setOfflineSessionActive(true);
    await keepAcademicYearCurrent('2027-2028');
    await keepAcademicYearCurrent('2027-2028');
    await keepAcademicYearCurrent('2027-2028');

    assert.equal(getOfflineQueue().length, 1, 'une déclaration est idempotente : une seule en attente suffit');
  });

  it('les années lues sont gardées sur le poste et relues quand la base ne répond plus', async () => {
    rowsResult = { data: [{ year_name: '2026-2027', is_current: true }, { year_name: '2027-2028', is_current: false }], error: null };
    const online = await fetchAcademicYears();
    assert.deepEqual(online?.map(r => r.year_name), ['2026-2027', '2027-2028']);

    // Base injoignable : le sélecteur garde les années que l'école a réellement,
    // au lieu de retomber sur le jeu de repli écrit en dur.
    rowsResult = { data: null, error: { message: 'network down' } };
    const offline = await fetchAcademicYears();
    assert.deepEqual(offline?.map(r => r.year_name), ['2026-2027', '2027-2028']);
    assert.equal(offline?.find(r => r.is_current)?.year_name, '2026-2027');
  });
});

describe('journal d’audit hors ligne', () => {
  it('un geste fait sans réseau part en file, signé par SON auteur', async () => {
    setAuditActor({ id: 'u1', email: 'aggee@mamathera.org', full_name: 'Aggee Diarra', role: 'staff' });
    setOfflineSessionActive(true);

    assert.equal(await logAuditEvent({ action: 'DELETE_CLASS', targetType: 'class', targetId: 'row-4a', details: '4A' }), true);
    assert.equal(calls.length, 0, 'aucune entrée n’est tentée vers la base sans réseau');

    const queued = getOfflineQueue()[0];
    assert.equal(queued.type, 'addAuditLog');
    if (queued.type !== 'addAuditLog') throw new Error('une entrée de journal devait être mise en file');
    assert.equal(queued.payload.userEmail, 'aggee@mamathera.org');
    assert.equal(queued.payload.userName, 'Aggee Diarra');
    assert.equal(queued.payload.action, 'DELETE_CLASS');
  });

  it('l’auteur de l’entrée est FIGÉ au moment du geste (pas celui qui rebranche le câble)', async () => {
    setAuditActor({ id: 'u1', email: 'aggee@mamathera.org', full_name: 'Aggee Diarra', role: 'staff' });
    setOfflineSessionActive(true);
    await logAuditEvent({ action: 'UPDATE_SETTINGS', details: 'thème sombre' });

    // L'auteur change (poste partagé, ou déconnexion avant l'envoi)…
    setAuditActor({ id: 'u2', email: 'autre@mamathera.org', full_name: 'Autre', role: 'admin' });
    const queued = getOfflineQueue()[0];
    if (queued.type !== 'addAuditLog') throw new Error('une entrée de journal devait être mise en file');
    assert.equal(queued.payload.userEmail, 'aggee@mamathera.org', 'le journal dit qui a fait, pas qui passait par là');
  });

  it('une résolution d’acteur impossible (réseau) n’est PAS mémorisée', async () => {
    // Ligne coupée : getUser lève. L'entrée part avec « system »…
    authThrows = true;
    await logAuditEvent({ action: 'UPDATE_SETTINGS', details: 'premier' });
    const first = calls.find(c => c.op === 'insert' && c.table === 'audit_logs');
    assert.equal(first?.payload?.user_email, 'system');

    // …mais la ligne revenue, l'auteur est retrouvé : l'ancienne version
    // mémorisait l'échec pour toute la page et signait « System Staff » à vie.
    authThrows = false;
    authUser = { id: 'u3', email: 'dg@mamathera.org', user_metadata: { full_name: 'Directrice' } };
    rowsResult = { data: { full_name: 'Directrice', role: 'admin' }, error: null };
    await logAuditEvent({ action: 'UPDATE_SETTINGS', details: 'second' });

    const inserts = calls.filter(c => c.op === 'insert' && c.table === 'audit_logs');
    assert.equal(inserts.length, 2);
    assert.equal(inserts[1].payload?.user_email, 'dg@mamathera.org');
  });
});
