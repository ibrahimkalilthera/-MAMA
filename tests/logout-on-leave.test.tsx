/**
 * Suite for `src/app/useLogoutOnLeave.ts` — la déconnexion à la SORTIE, qui
 * remplace le minuteur d'inactivité de 30 minutes.
 *
 * Deux choses sont verrouillées ici, et pas une de moins :
 *   1. le comportement RÉEL sur un DOM : partir ferme la session (le stockage
 *      est vidé ET le serveur est prévenu), et une seule fois par départ ;
 *   2. la classe est FERMÉE : plus aucun fichier de `src/` ne porte le minuteur,
 *      son réglage d'équipe ni son alerte — parce que « on l'a retiré » se
 *      vérifie en le cherchant, pas en le promettant.
 *
 * Le second point compte autant que le premier : le défaut d'origine n'était pas
 * que le minuteur existât, c'est qu'il jugeait une DURÉE (30 minutes sans
 * geste) au lieu d'un ÉVÉNEMENT. Il laissait donc une session ouverte devant
 * une machine quittée, et la fermait devant quelqu'un qui travaillait.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';
import {
  clearSupabaseSession,
  LEAVE_EVENTS,
  SUPABASE_SESSION_KEY,
  useLogoutOnLeave,
} from '../src/app/useLogoutOnLeave';

const win = installDomGlobals();
const STORAGE = win.sessionStorage as unknown as Storage;

const SESSION_KEY = 'sb-rpcjdohfxwukbqngbprw-auth-token';

beforeEach(() => {
  STORAGE.clear();
});

describe('clearSupabaseSession — le stockage, sans connaître l’URL du projet', () => {
  it('retire les clés de session Supabase et RIEN d’autre', () => {
    STORAGE.setItem(SESSION_KEY, '{"access_token":"x"}');
    STORAGE.setItem('sb-autre-auth-token-code-verifier', 'v');
    STORAGE.setItem('mama-thera:offline-queue', '[{"op":"x"}]');
    STORAGE.setItem('theme', 'emerald');

    const removed = clearSupabaseSession(STORAGE);

    assert.deepEqual(removed.sort(), [SESSION_KEY, 'sb-autre-auth-token-code-verifier'].sort());
    assert.equal(STORAGE.getItem(SESSION_KEY), null);
    assert.equal(
      STORAGE.getItem('mama-thera:offline-queue'),
      '[{"op":"x"}]',
      'la file hors ligne NE DOIT PAS être emportée par une déconnexion',
    );
    assert.equal(STORAGE.getItem('theme'), 'emerald', 'un réglage d’affichage n’est pas une session');
  });

  it('la forme reconnue est celle de supabase-js, et elle est étroite', () => {
    assert.equal(SUPABASE_SESSION_KEY.test(SESSION_KEY), true);
    assert.equal(SUPABASE_SESSION_KEY.test('sb-x-auth-token-code-verifier'), true);
    for (const notSession of ['auth-token', 'sb-x-token', 'token', 'session']) {
      assert.equal(SUPABASE_SESSION_KEY.test(notSession), false, notSession);
    }
  });
});

describe('useLogoutOnLeave — partir ferme la session', () => {
  it('sur `pagehide` : stockage vidé ET serveur prévenu, une fois', () => {
    let calls = 0;
    STORAGE.setItem(SESSION_KEY, '{"access_token":"x"}');
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: true,
      signOut: async () => {
        calls += 1;
      },
      storage: STORAGE,
    });

    act(() => {
      win.dispatchEvent(new win.Event('pagehide'));
    });

    assert.equal(calls, 1, 'la sortie a prévenu le serveur (révocation, pas seulement oubli local)');
    assert.equal(STORAGE.getItem(SESSION_KEY), null, 'le stockage est vidé au même instant');
    unmount();
  });

  it('`beforeunload` après `pagehide` ne rejoue pas la sortie — un départ, une révocation', () => {
    let calls = 0;
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: true,
      signOut: async () => {
        calls += 1;
      },
      storage: STORAGE,
    });

    act(() => {
      win.dispatchEvent(new win.Event('pagehide'));
      win.dispatchEvent(new win.Event('beforeunload'));
    });

    assert.equal(calls, 1, 'les deux événements d’un même départ ne valent pas deux déconnexions');
    unmount();
  });

  it('`beforeunload` seul suffit — certains chemins de fermeture Electron n’émettent que lui', () => {
    let calls = 0;
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: true,
      signOut: async () => {
        calls += 1;
      },
      storage: STORAGE,
    });

    act(() => {
      win.dispatchEvent(new win.Event('beforeunload'));
    });

    assert.equal(calls, 1);
    unmount();
  });

  it('sans session ouverte, rien n’est fermé — et aucun écouteur ne reste armé', () => {
    let calls = 0;
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: false,
      signOut: async () => {
        calls += 1;
      },
      storage: STORAGE,
    });

    for (const ev of LEAVE_EVENTS) {
      act(() => {
        win.dispatchEvent(new win.Event(ev));
      });
    }

    assert.equal(calls, 0, 'quitter l’écran de connexion n’est pas une déconnexion');
    unmount();
  });

  it('après démontage, un départ ne ferme plus rien', () => {
    let calls = 0;
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: true,
      signOut: async () => {
        calls += 1;
      },
      storage: STORAGE,
    });
    unmount();

    act(() => {
      win.dispatchEvent(new win.Event('pagehide'));
    });

    assert.equal(calls, 0);
  });

  it('un `signOut` qui échoue ne fait pas lever le départ', () => {
    const { unmount } = renderHook(useLogoutOnLeave, {
      enabled: true,
      signOut: async () => {
        throw new Error('réseau coupé');
      },
      storage: STORAGE,
    });

    assert.doesNotThrow(() => {
      act(() => {
        win.dispatchEvent(new win.Event('pagehide'));
      });
    });
    unmount();
  });
});

/**
 * Le minuteur est parti, et il ne peut pas revenir par inadvertance. Le
 * contrôle lit TOUT `src/` : un fichier qui réintroduirait le minuteur, son
 * réglage d'équipe ou son alerte nommerait l'un de ces identifiants, et ce sont
 * exactement les noms qu'une réintroduction réutiliserait.
 */
describe('la classe est fermée : le minuteur d’inactivité n’existe plus dans src/', () => {
  const SRC = join(import.meta.dirname, '..', 'src');
  const FORBIDDEN = /useInactivityLogout|teamSettings|InactivityWarning|inactivityMinutes|inactivityMinutesLabel/;

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it('aucun fichier ne porte plus le minuteur, son réglage ni son alerte', () => {
    const offenders = walk(SRC)
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1).replace(/\\/g, '/'));
    assert.deepEqual(
      offenders,
      [],
      'la déconnexion se fait à la SORTIE (src/app/useLogoutOnLeave.ts), plus après une durée',
    );
  });

  it('le contrôle lit vraiment un corpus — un scan devenu aveugle ne prouve rien', () => {
    const files = walk(SRC);
    assert.ok(files.length >= 100, `fichiers src/ parcourus : ${files.length}`);
    // Anti-vacuité du motif : il MORD sur du texte qu'un retour du minuteur
    // écrirait, donc une liste vide veut bien dire « absent », pas « motif mort ».
    assert.equal(FORBIDDEN.test('import { useInactivityLogout } from ...'), true);
    assert.equal(FORBIDDEN.test('inactivityMinutes: number;'), true);
  });

  it('les deux événements de sortie sont bien ceux que le navigateur et Electron émettent', () => {
    assert.deepEqual([...LEAVE_EVENTS], ['pagehide', 'beforeunload']);
  });
});
