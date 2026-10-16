/**
 * Suite pure pour src/lib/chunkLoadRecovery.ts — la reprise d'un import
 * dynamique échoué (chunk périmé), sans DOM.
 *
 * Un React.lazy rejeté est mémorisé : seule une page reload peut récupérer.
 * Ces tests verrouillent la détection du message, le garde anti-boucle, et le
 * branchement de `vite:preloadError`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELOAD_GUARD_KEY,
  isChunkLoadError,
  shouldAutoReload,
  recoverFromChunkLoadError,
  registerChunkLoadRecovery,
} from '../src/lib/chunkLoadRecovery';

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
};

describe('chunkLoadRecovery — un import dynamique échoué se récupère par rechargement', () => {
  it('reconnaît le message Vite et refuse une erreur ordinaire', () => {
    assert.equal(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: http://127.0.0.1:3000/src/components/ExpensesView.tsx')),
      true,
    );
    assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true);
    assert.equal(isChunkLoadError('ChunkLoadError'), true);
    assert.equal(isChunkLoadError(new Error('boom du sous-arbre')), false);
    assert.equal(isChunkLoadError(undefined), false);
  });

  it('garde anti-boucle : un rechargement récent supprime le suivant', () => {
    assert.equal(shouldAutoReload(20000, 0, 15000), true);
    assert.equal(shouldAutoReload(10000, 0, 15000), false);
    assert.equal(shouldAutoReload(1000, Number.NaN), true);
  });

  it('recharge une seule fois dans la fenêtre, puis plus', () => {
    const storage = fakeStorage();
    let reloads = 0;
    const reload = () => { reloads += 1; };

    assert.equal(recoverFromChunkLoadError(20000, storage, reload, 15000), true);
    assert.equal(reloads, 1);
    assert.equal(storage.getItem(RELOAD_GUARD_KEY), '20000');
    assert.equal(recoverFromChunkLoadError(25000, storage, reload, 15000), false);
    assert.equal(reloads, 1);
    assert.equal(recoverFromChunkLoadError(40000, storage, reload, 15000), true);
    assert.equal(reloads, 2);
  });

  it('branche `vite:preloadError` sur un rechargement gardé', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    let reloads = 0;
    const win = {
      addEventListener: (type: string, listener: (event: { preventDefault(): void }) => void) => {
        listeners.set(type, listener);
      },
      location: { reload: () => { reloads += 1; } },
      sessionStorage: fakeStorage(),
    };

    registerChunkLoadRecovery(win, () => 1000);
    const listener = listeners.get('vite:preloadError');
    assert.ok(listener, 'le gestionnaire est enregistré');

    let prevented = 0;
    listener!({ preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 1, 'la propagation par défaut est bloquée');
    assert.equal(reloads, 1, 'la page est rechargée');
    assert.equal(win.sessionStorage.getItem(RELOAD_GUARD_KEY), '1000');

    // No-op quand la fenêtre n'expose pas addEventListener (SSR, test).
    assert.doesNotThrow(() => registerChunkLoadRecovery(undefined));
  });

  // LE GARDE QUI REFUSE NE DOIT PAS BLOQUER L'ÉVÉNEMENT — le contraire rendait
  // `undefined` à la place d'une erreur. Mesuré le 2026-10-16 : un morceau
  // manqué pendant un encaissement a produit « TypeError: Cannot destructure
  // property 'PDFDocument' of '(intermediate value)' as it is undefined », parce
  // que le helper de Vite ne relance l'erreur que si l'événement n'a pas été
  // bloqué (`if (!event.defaultPrevented) throw error`). Bloquer sans recharger
  // transforme donc une panne de chargement en un module « undefined ».
  it('quand le garde refuse le rechargement, l’événement N’EST PAS bloqué (l’erreur continue sa route)', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    let reloads = 0;
    const storage = fakeStorage();
    // Un rechargement vient d'avoir lieu : le suivant est supprimé.
    storage.setItem(RELOAD_GUARD_KEY, '60000');
    const win = {
      addEventListener: (type: string, listener: (event: { preventDefault(): void }) => void) => {
        listeners.set(type, listener);
      },
      location: { reload: () => { reloads += 1; } },
      sessionStorage: storage,
    };

    registerChunkLoadRecovery(win, () => 61000);
    const listener = listeners.get('vite:preloadError');
    assert.ok(listener, 'le gestionnaire est enregistré');

    let prevented = 0;
    listener!({ preventDefault: () => { prevented += 1; } });
    assert.equal(reloads, 0, 'le garde a supprimé le rechargement');
    assert.equal(prevented, 0, 'rien n’a été récupéré : l’erreur doit rester une erreur');
    assert.equal(storage.getItem(RELOAD_GUARD_KEY), '60000', 'le garde n’est pas réécrit');
  });
});
