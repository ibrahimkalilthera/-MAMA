/**
 * Preuves de `src/lib/readCompleteness.ts`.
 *
 * Le défaut mesuré : PostgREST rend 1 000 lignes et un 200, donc une lecture
 * non paginée de `payments` perd les reçus les plus récents sans le dire. Ces
 * cas fixent la frontière exacte — 999, 1 000, 1 001 — pour qu'une future
 * « optimisation » ne puisse pas déplacer le silence d'un cran.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTGREST_PAGE_SIZE,
  formatShortfall,
  isTruncated,
  mergePages,
  planPages,
  shortfallOf,
} from '../src/lib/readCompleteness';

describe('readCompleteness — le plafond PostgREST se nomme', () => {
  it('1 000 est le plafond, et il est public', () => {
    assert.equal(POSTGREST_PAGE_SIZE, 1000);
  });

  it('une page incomplète sans total n’est PAS une troncature prouvée', () => {
    assert.equal(isTruncated(999, null), false);
    assert.equal(shortfallOf('paiements', 999, null), null, 'en dessous d’une page, il n’y a rien à dire');
  });

  it('une page PLEINE sans total est suspecte, jamais déclarée complète', () => {
    assert.equal(isTruncated(1000, null), false, 'sans total, on ne peut pas trancher');
    const suspect = shortfallOf('paiements', 1000, null);
    assert.ok(suspect, 'exactement 1 000 peut aussi bien être 1 412');
    assert.equal(suspect.total, null);
    assert.match(formatShortfall(suspect), /au moins 1 000 lignes lues, le total est inconnu/);
  });

  it('un total égal au chargé est complet ; un total supérieur est une troncature', () => {
    assert.equal(shortfallOf('paiements', 1000, 1000), null);
    assert.equal(isTruncated(1000, 1000), false);
    assert.equal(isTruncated(1001, 1000), false, 'charger PLUS que le total n’est pas un manque');

    const truncated = shortfallOf('paiements', 1000, 1412);
    assert.ok(truncated);
    assert.equal(truncated.table, 'paiements');
    assert.equal(truncated.loaded, 1000);
    assert.equal(truncated.total, 1412);
    assert.equal(isTruncated(1000, 1412), true);
  });

  it('la phrase nomme la table et les DEUX nombres', () => {
    const text = formatShortfall({ table: 'paiements', loaded: 1000, total: 1412 });
    assert.match(text, /^paiements : chargé 1 000 sur 1 412/);
    assert.match(text, /la suite n’a pas été lue/);
    assert.doesNotMatch(text, /récent/, 'sans ordre déclaré, aucun côté n’est nommé');
  });

  it('« les plus récentes » n’est écrit que si la lecture est triée par date croissante', () => {
    const text = formatShortfall(
      { table: 'paiements', loaded: 1000, total: 1412 },
      { readAscendingByDate: true },
    );
    assert.match(text, /les lignes les plus récentes manquent/);
  });

  it('les pages couvrent le total, sans jamais demander de page au-delà', () => {
    assert.deepEqual(planPages(null), [0], 'un total inconnu ne se planifie pas d’avance');
    assert.deepEqual(planPages(999), [0]);
    assert.deepEqual(planPages(1000), [0], 'la page suivante serait vide');
    assert.deepEqual(planPages(1001), [0, 1000]);
    assert.deepEqual(planPages(1412), [0, 1000]);
    assert.deepEqual(planPages(2001), [0, 1000, 2000]);
    assert.deepEqual(planPages(1412, 500), [0, 500, 1000], 'la taille de page est un paramètre');
  });

  it('une taille de page absurde est refusée, pas silencieusement corrigée', () => {
    assert.throws(() => planPages(10, 0), RangeError);
    assert.throws(() => planPages(10, -1), RangeError);
  });

  it('la fusion garde l’ordre des pages', () => {
    assert.deepEqual(mergePages([[1, 2], [3], [4, 5]]), [1, 2, 3, 4, 5]);
    assert.deepEqual(mergePages([]), []);
  });
});
