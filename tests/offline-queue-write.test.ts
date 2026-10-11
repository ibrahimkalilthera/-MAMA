/**
 * Le CONTRAT D'ÉCRITURE de la file hors ligne (src/lib/offlineQueue.ts).
 *
 * ─── Pourquoi ces cas existent ─────────────────────────────────────────────
 * La file vit dans `localStorage`, qui a un quota : quand il est atteint,
 * `setItem` LÈVE. L'ancienne version avalait cette exception dans un
 * `console.error`, la file ne contenait rien, et l'écran annonçait quand même
 * « enregistré » — un paiement pouvait donc être perdu en étant annoncé écrit,
 * alors que le reçu était déjà dans la main du parent. Trois défauts, un seul
 * symptôme, et aucun ne laissait de trace :
 *
 *   • l'échec d'écriture était MUET (un `console.error` que personne ne lit) ;
 *   • la file n'avait AUCUN plafond, donc elle ne pouvait pas refuser — elle
 *     mourait sur le quota du navigateur, sans borne nommée ;
 *   • une file STOCKÉE mais illisible se lisait comme une file VIDE, et
 *     l'écriture suivante écrasait les gestes en attente (perte silencieuse de
 *     tout ce qui n'était pas encore remonté).
 *
 * Ces cas tournent sans navigateur : le magasin de la file est remplacé par un
 * faux `localStorage` (le module lit `typeof localStorage` à chaque appel), donc
 * un quota plein se rejoue à volonté — et la panne qu'on veut empêcher se teste
 * au lieu de s'espérer.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFLINE_QUEUE_MAX_ITEMS,
  OfflineQueueWriteError,
  clearOfflineQueue,
  enqueueOfflineAction,
  getOfflineQueue,
  getOfflineQueueCount,
  saveOfflineQueue,
} from '../src/lib/offlineQueue';

const STORAGE_KEY = 'mama_thera_offline_queue';
const NOTE = { date: '2026-10-11', text: 'note de sonde' };

/** Un geste de sonde, de la forme exacte que la file range. */
function item(index: number): unknown {
  return { id: `off_${index}`, type: 'addNote', payload: NOTE, createdAt: '2026-10-11T00:00:00.000Z', attempts: 0 };
}

/**
 * Un `localStorage` de laboratoire — qui peut refuser d'écrire.
 *
 * C'est le seul moyen d'éprouver le quota : un vrai navigateur ne le remplit pas
 * à la demande, et le défaut qu'on répare ne se produit que là.
 */
function installFakeStorage({ full = false }: { full?: boolean } = {}) {
  const map = new Map<string, string>();
  const fake = {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      if (full) throw new Error('QuotaExceededError: localStorage is full');
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
  return map;
}

afterEach(() => {
  // Le magasin par défaut redevient celui du module (mémoire) : aucune fuite
  // d'état entre les suites qui partagent ce même processus.
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  clearOfflineQueue();
});

describe('file hors ligne — le plafond est NOMMÉ, et il refuse au lieu de mourir', () => {
  it('le plafond existe, il est explicite, et son message le dit', () => {
    assert.ok(OFFLINE_QUEUE_MAX_ITEMS > 0, 'un plafond nul refuserait tout geste');
    assert.equal(typeof OFFLINE_QUEUE_MAX_ITEMS, 'number');
    const error = new OfflineQueueWriteError('queue-full');
    assert.equal(error.reason, 'queue-full');
    assert.match(error.message, new RegExp(String(OFFLINE_QUEUE_MAX_ITEMS)), 'le message nomme le plafond');
    assert.match(error.message, /PAS été enregistré/, 'et il dit ce qui est vrai');
  });

  it('une file PLEINE refuse le geste suivant — et ne le remplace pas', () => {
    installFakeStorage();
    saveOfflineQueue(Array.from({ length: OFFLINE_QUEUE_MAX_ITEMS }, (_, i) => item(i) as never));
    const before = getOfflineQueueCount();
    assert.equal(before, OFFLINE_QUEUE_MAX_ITEMS, 'la file est bien au plafond');

    assert.throws(
      () => enqueueOfflineAction('addNote', NOTE),
      (error: unknown) =>
        error instanceof OfflineQueueWriteError &&
        error.reason === 'queue-full' &&
        /PAS été enregistré/.test(error.message),
      'le geste est REFUSÉ en le disant',
    );
    assert.equal(getOfflineQueueCount(), OFFLINE_QUEUE_MAX_ITEMS, 'et rien n’a été ajouté ni retiré');
  });

  it('juste SOUS le plafond, le geste passe encore', () => {
    installFakeStorage();
    saveOfflineQueue(Array.from({ length: OFFLINE_QUEUE_MAX_ITEMS - 1 }, (_, i) => item(i) as never));
    enqueueOfflineAction('addNote', NOTE);
    assert.equal(getOfflineQueueCount(), OFFLINE_QUEUE_MAX_ITEMS, 'le dernier rang est accepté');
  });
});

describe('file hors ligne — une écriture qui échoue se DIT (quota plein)', () => {
  it('le geste n’est pas rangé, et l’erreur porte la cause — jamais un `console.error` muet', () => {
    installFakeStorage({ full: true });
    const stored = getOfflineQueueCount();
    assert.equal(stored, 0, 'rien n’a pu être écrit');

    assert.throws(
      () => enqueueOfflineAction('addNote', NOTE),
      (error: unknown) =>
        error instanceof OfflineQueueWriteError &&
        error.reason === 'storage-failed' &&
        /PAS été enregistré/.test(error.message),
    );
    assert.equal(getOfflineQueueCount(), 0, 'et la file ne contient pas un geste qui n’a pas été écrit');
  });

  it('`saveOfflineQueue` REND COMPTE au lieu de lever — l’appelant décide', () => {
    installFakeStorage({ full: true });
    const result = saveOfflineQueue([]);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'storage-failed');

    installFakeStorage();
    assert.deepEqual(saveOfflineQueue([]), { ok: true });
  });
});

describe('file hors ligne — un magasin ILLISIBLE n’est pas une file vide', () => {
  beforeEach(() => {
    installFakeStorage();
    // Le cas mesuré : des octets en attente… qui ne se relisent pas.
    localStorage.setItem(STORAGE_KEY, '{"pas":"une liste"}');
  });

  it('la lecture rend vide, mais l’écriture REFUSE — les gestes en attente ne sont pas écrasés', () => {
    assert.deepEqual(getOfflineQueue(), [], 'on ne peut pas lire ce qu’on ne comprend pas');

    assert.throws(
      () => enqueueOfflineAction('addNote', NOTE),
      (error: unknown) => error instanceof OfflineQueueWriteError && error.reason === 'storage-unreadable',
    );
    assert.equal(
      localStorage.getItem(STORAGE_KEY),
      '{"pas":"une liste"}',
      'les octets d’origine sont INTACTS : une lecture ratée n’écrase rien',
    );
  });

  it('vider la file est la sortie de secours : après elle, l’écriture repasse', () => {
    clearOfflineQueue();
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
    enqueueOfflineAction('addNote', NOTE);
    assert.equal(getOfflineQueueCount(), 1, 'la file repart');
  });
});
