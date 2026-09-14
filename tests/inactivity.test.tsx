/**
 * Suite for `src/app/useInactivityLogout.ts` — la déconnexion après **45 minutes
 * d'inactivité**, la même fenêtre pour tous les comptes.
 *
 * Trois choses sont verrouillées ici, et chacune a été payée par une décision :
 *   1. **la durée est exactement 45 minutes**, et c'est l'INACTIVITÉ qui la
 *      remplit : n'importe quel geste (appui, touche, défilement, molette,
 *      souris) la relance ;
 *   2. **un rechargement (F5) n'est PAS un départ** : au déchargement, rien
 *      n'appelle `signOut()`. Aucune API de navigateur ne distingue un F5 d'une
 *      fermeture à cet instant, donc la seule façon d'épargner F5 est de ne rien
 *      révoquer là — et un cas le mesure sur `pagehide` ET `beforeunload` ;
 *   3. **le réglage d'équipe n'existe plus** : plus aucun fichier de `src/` ne
 *      porte `app_settings`/`inactivity_minutes`, la fenêtre est une constante
 *      partagée par tout le monde (« n'importe quel utilisateur »).
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';
import { maskComments } from '../scripts/lib/source-text.mjs';
import {
  INACTIVITY_MINUTES,
  INACTIVITY_WARN_SECONDS,
  useInactivityLogout,
} from '../src/app/useInactivityLogout';

const win = installDomGlobals();
const MINUTE = 60_000;

type Api = ReturnType<typeof useInactivityLogout>;

/** Un compteur de déconnexions + le rendu du hook, dans la même foulée. */
function mount(signOut: () => Promise<void>, enabled = true) {
  const ref: { current: Api | null } = { current: null };
  const render = renderHook(useInactivityLogout, { enabled, signOut }, ref);
  return { ...render, ref };
}

describe('la fenêtre est de 45 minutes, la même pour tous les comptes', () => {
  it('la constante est 45 — pas 30, pas un réglage lu quelque part', () => {
    assert.equal(INACTIVITY_MINUTES, 45);
    assert.equal(INACTIVITY_WARN_SECONDS, 60, 'le préavis laisse le temps de réagir');
  });
});

describe('useInactivityLogout — l’inactivité ferme la session', () => {
  beforeEach(() => mock.timers.reset());

  it('45 minutes sans le moindre geste → déconnecté, une fois', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let calls = 0;
    const { ref, unmount } = mount(async () => {
      calls += 1;
    });

    act(() => {
      mock.timers.tick(INACTIVITY_MINUTES * MINUTE - 1);
    });
    assert.equal(calls, 0, 'à une milliseconde du seuil, la session est encore ouverte');

    act(() => {
      mock.timers.tick(1);
    });
    assert.equal(ref.current!.warningOpen, true, 'le préavis s’ouvre à la fin de la fenêtre');

    act(() => {
      mock.timers.tick(INACTIVITY_WARN_SECONDS * 1000);
    });
    assert.equal(calls, 1, 'le préavis écoulé ferme la session');
    unmount();
  });

  it('le préavis décompte vraiment, et « je suis toujours là » rouvre la fenêtre entière', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let calls = 0;
    const { ref, unmount } = mount(async () => {
      calls += 1;
    });

    act(() => {
      mock.timers.tick(INACTIVITY_MINUTES * MINUTE);
    });
    act(() => {
      mock.timers.tick(10_000);
    });
    assert.equal(ref.current!.remainingSeconds, INACTIVITY_WARN_SECONDS - 10);

    act(() => {
      ref.current!.reset();
    });
    assert.equal(ref.current!.warningOpen, false, 'le préavis est écarté');
    assert.equal(calls, 0, 'rester connecté ne déconnecte personne');

    // La fenêtre est repartie POUR ENTIER : 44 minutes plus tard, toujours rien.
    act(() => {
      mock.timers.tick(44 * MINUTE);
    });
    assert.equal(calls, 0);
    unmount();
  });

  it('chaque geste relance la fenêtre — appui, clavier, défilement, molette, toucher', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let calls = 0;
    const { unmount } = mount(async () => {
      calls += 1;
    });

    // 44 minutes, un geste, 44 minutes : sans le relais, la coupure serait
    // tombée depuis longtemps.
    for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel']) {
      act(() => {
        mock.timers.tick(44 * MINUTE);
        win.dispatchEvent(new win.Event(type));
      });
      assert.equal(calls, 0, `« ${type} » prouve une présence`);
    }
    unmount();
  });

  it('la souris compte aussi — et la fenêtre repart alors POUR ENTIER', () => {
    // `Date` est simulée ici : le déplacement de souris est le SEUL geste qui
    // consulte l'horloge (au plus une fois toutes les 30 s), donc sans horloge
    // simulée ce cas mesurerait le throttle, pas la relance.
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    let calls = 0;
    const { ref, unmount } = mount(async () => {
      calls += 1;
    });

    // 44 minutes d'immobilité, puis un geste de souris.
    act(() => {
      mock.timers.tick(44 * MINUTE);
    });
    act(() => {
      win.dispatchEvent(new win.Event('mousemove'));
    });
    // 44 minutes plus tard : sans la relance, la coupure serait tombée depuis
    // longtemps (l'échéance d'origine était à 45 minutes du montage).
    act(() => {
      mock.timers.tick(44 * MINUTE);
    });
    assert.equal(calls, 0, 'la souris a repoussé l’échéance');
    assert.equal(ref.current!.warningOpen, false, 'et aucun préavis n’est ouvert');

    // Et sans nouveau geste, la fenêtre tient sa promesse : 45 minutes depuis
    // le geste, plus le préavis écoulé.
    act(() => {
      mock.timers.tick(MINUTE);
    });
    act(() => {
      mock.timers.tick(INACTIVITY_WARN_SECONDS * 1000);
    });
    assert.equal(calls, 1, 'un geste ne vaut pas pour les 45 minutes suivantes');
    unmount();
  });

  it('sans session ouverte, aucun minuteur ne tourne', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let calls = 0;
    const { unmount } = mount(async () => {
      calls += 1;
    }, false);

    act(() => {
      mock.timers.tick(120 * MINUTE);
    });
    assert.equal(calls, 0, 'l’écran de connexion n’a pas de session à fermer');
    unmount();
  });
});

describe('un rechargement (F5) n’est PAS un départ', () => {
  beforeEach(() => mock.timers.reset());

  it('`pagehide` et `beforeunload` ne ferment rien — c’est tout l’objet de ce choix', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let calls = 0;
    const { unmount } = mount(async () => {
      calls += 1;
    });

    act(() => {
      win.dispatchEvent(new win.Event('pagehide'));
      win.dispatchEvent(new win.Event('beforeunload'));
    });

    assert.equal(
      calls,
      0,
      'rien n’est révoqué au déchargement : c’est ce qui laisse F5 dans la session (la session vit dans sessionStorage)',
    );
    unmount();
    mock.timers.reset();
  });

  it('aucun fichier de src/ n’écoute le déchargement — la classe est fermée', () => {
    const SRC = join(import.meta.dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
      });

    const files = walk(SRC);
    assert.ok(files.length >= 100, `fichiers src/ parcourus : ${files.length}`);

    const listeners = files.filter((file) =>
      // Le MOT dans du code, pas dans la prose : les commentaires de
      // `useInactivityLogout` nomment ces deux événements pour expliquer
      // pourquoi on ne les écoute plus, et c'est exactement ce qu'on veut lire.
      /addEventListener\(\s*['"](pagehide|beforeunload)['"]/.test(readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
      listeners.map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/')),
      [],
      'révoquer à la sortie ferait de F5 une déconnexion — mesuré et refusé',
    );
  });
});

describe('le réglage d’équipe n’existe plus', () => {
  const SRC = join(import.meta.dirname, '..', 'src');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it('aucun fichier ne lit ni n’écrit `inactivity_minutes`', () => {
    // La prose est blanchie : `useInactivityLogout` NOMME ce réglage dans son
    // en-tête pour dire qu'il a disparu, et ce commentaire n'est pas un lecteur.
    // `lib/database.types.ts` porte `app_settings` parce qu'il décrit la table
    // (elle reste : c'est le magasin de réglages d'équipe) — la clé, elle, n'a
    // plus aucun lecteur.
    const offenders = walk(SRC)
      .filter((file) => /inactivity_minutes/.test(maskComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(SRC.length + 1).replace(/\\/g, '/'));
    assert.deepEqual(
      offenders,
      [],
      'la fenêtre est une constante partagée par tout le monde, pas une ligne en base',
    );
  });

  it('le contrôle mord : le motif reconnaît un vrai lecteur', () => {
    assert.equal(
      /inactivity_minutes/.test(maskComments("await supabase.from('app_settings').eq('key', 'inactivity_minutes')")),
      true,
    );
    assert.equal(
      /inactivity_minutes/.test(maskComments('// app_settings.inactivity_minutes : retiré le 14/09')),
      false,
      'la prose qui explique le retrait n’est pas un lecteur',
    );
  });
});
