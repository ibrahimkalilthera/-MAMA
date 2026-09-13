// Suite for scripts/lib/read-after-submit.mjs — la brique qui lit en base ce
// qu'un envoi de formulaire vient d'écrire.
//
// WHY THIS EXISTS
// ---------------
// Audit du 2026-09-13 : le MÊME défaut recopié sept fois dans la chaîne E2E —
// on cliquait « Enregistrer », on attendait 2–3 s, on lisait la table UNE fois,
// et on concluait. Deux situations très différentes se lisaient alors
// identiquement : « pas encore visible » et « jamais écrit ». Le run rouge
// accusait donc l'application d'un simple retard.
//
// La cadence est INJECTÉE (`read` et `sleep`), donc chaque propriété qui compte
// se prouve sans réseau et sans attendre une seconde de vraie horloge.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { SETTLE_ATTEMPTS, firstRow, readUntil } from '../scripts/lib/read-after-submit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Un lecteur qui rend les corps d'une liste, et compte les lectures. */
const reader = (bodies: unknown[]) => {
  const calls: number[] = [];
  return {
    calls,
    read: async () => {
      calls.push(calls.length + 1);
      return bodies[Math.min(calls.length - 1, bodies.length - 1)];
    },
  };
};

describe('lire après un envoi : s’arrêter dès que l’état est là', () => {
  it('l’état est déjà là → UNE lecture, et aucune attente payée', async () => {
    // Le cas courant : la base est à jour. Le contrôle ne doit donc rien payer
    // pour se rassurer — sinon chaque lecture ajouterait une seconde au run.
    const r = reader([{ body: [{ id: 'x' }] }]);
    let sleeps = 0;
    const out = await readUntil({ read: r.read, isReady: (body) => firstRow((body as { body: unknown }).body), sleep: async () => { sleeps += 1; } });
    assert.equal(out.reads, 1);
    assert.equal(sleeps, 0, 'le premier essai ne dort jamais');
    assert.deepEqual(out.value, { id: 'x' });
  });

  it('l’état arrive au 3ᵉ essai → il est rendu, et le nombre de lectures est DIT', async () => {
    // C'est le cas mesuré (« le même run passait 3 fois et échouait la 4ᵉ ») : le
    // compte est publié pour qu'un run qui a attendu se lise.
    const r = reader([[], [], [{ id: 'y' }]]);
    const waits: number[] = [];
    const out = await readUntil({
      read: r.read,
      isReady: firstRow,
      intervalMs: 40,
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(out.reads, 3);
    assert.deepEqual(out.value, { id: 'y' });
    assert.deepEqual(waits, [40, 40], 'deux attentes, pas trois');
  });

  it('jamais là → on conclut à l’absence après le nombre d’essais, sans attente finale', async () => {
    const r = reader([[]]);
    let sleeps = 0;
    const out = await readUntil({
      read: r.read,
      isReady: firstRow,
      attempts: 4,
      sleep: async () => { sleeps += 1; },
    });
    assert.equal(out.value, null);
    assert.equal(out.reads, 4);
    assert.equal(sleeps, 3, 'attendre après le DERNIER essai allongerait un échec déjà jugé');
  });

  it('on attend l’ÉTAT attendu, pas « une ligne »', async () => {
    // Une lecture qui rend une ligne mais pas la bonne valeur (un solde encore à
    // 0, un statut encore `paid`) n'est pas un succès — sinon la brique
    // remplacerait un faux rouge par un faux vert.
    const r = reader([[{ amount_paid: 0 }], [{ amount_paid: 0 }], [{ amount_paid: 50000 }]]);
    const out = await readUntil({
      read: r.read,
      isReady: (body) => {
        const row = firstRow(body) as { amount_paid: number } | null;
        return row && row.amount_paid === 50000 ? row : null;
      },
      sleep: async () => {},
    });
    assert.equal(out.reads, 3);
    assert.equal((out.value as { amount_paid: number }).amount_paid, 50000);
  });

  it('un prédicat qui rend `false` veut dire « pas encore », et ne s’arrête pas', async () => {
    // Piège verrouillé : `false` est une valeur falsy mais légitime d'un
    // prédicat booléen, et la confondre avec un succès arrêterait la boucle sur
    // un échec.
    const r = reader([false, false, true]);
    const out = await readUntil({ read: r.read, isReady: (b) => b as boolean, sleep: async () => {} });
    assert.equal(out.reads, 3);
    assert.equal(out.value, true);
  });

  it('une lecture qui LÈVE n’est pas avalée : le transport a déjà décidé', async () => {
    // `api` (le transport de chaque script) a ses propres reprises de coupures.
    // Si une erreur survit, c'est un fait — la masquer ici rendrait un « absent »
    // mensonger.
    await assert.rejects(
      () => readUntil({ read: async () => { throw new Error('ECONNRESET'); }, isReady: firstRow, sleep: async () => {} }),
      /ECONNRESET/,
    );
  });

  it('la cadence réelle fonctionne (petit délai, vraie horloge)', async () => {
    // Une propriété qui ne se prouve pas avec un `sleep` injecté : que la boucle
    // fonctionne avec de VRAIS timers. 5 ms suffisent.
    const r = reader([[], [{ id: 'z' }]]);
    const started = Date.now();
    const out = await readUntil({ read: r.read, isReady: firstRow, intervalMs: 30 });
    assert.equal(out.reads, 2);
    assert.deepEqual(out.value, { id: 'z' });
    assert.ok(Date.now() - started >= 25, 'l’attente a bien eu lieu');
  });

  it('la borne par défaut est celle que les scripts utilisent', () => {
    assert.equal(SETTLE_ATTEMPTS, 10);
    assert.equal(firstRow([]), null);
    assert.equal(firstRow({ _nonJson: 'x' }), null, 'un corps non-JSON n’est pas une ligne');
    assert.deepEqual(firstRow([{ id: 1 }, { id: 2 }]), { id: 1 });
  });
});

describe('le câblage : la chaîne E2E lit en base par la même brique', () => {
  it('les deux scripts qui lisent en base après un envoi importent la brique partagée', () => {
    for (const file of ['scripts/e2e-business.mjs', 'scripts/verify-pdf-download.mjs']) {
      assert.match(read(file), /from '\.\/lib\/read-after-submit\.mjs'/, `${file} doit lire par la brique partagée`);
    }
  });

  it('un « absent » de la chaîne dit COMBIEN de lectures ont été faites', () => {
    // C'est ce qui distingue « lu une fois et pas là » de « attendu et pas là » :
    // sans le compte, un rouge redevient équivoque — exactement le défaut que
    // cette brique répare.
    const business = read('scripts/e2e-business.mjs');
    const slowChecks = business.match(/check\('(?:Classe|Élève|Parent|Employé)[^']*en base'/g) ?? [];
    assert.ok(slowChecks.length >= 4, `attendu au moins 4 contrôles « persisté en base », lu ${slowChecks.length}`);
    assert.equal(
      (business.match(/lecture\(s\)`/g) ?? []).length >= 5,
      true,
      'chaque contrôle « en base » doit publier le nombre de lectures dans son détail d’échec',
    );
    assert.doesNotMatch(business, /const (par|stf|st) = await api\(/, 'plus aucune lecture unique après un envoi');
  });
});
