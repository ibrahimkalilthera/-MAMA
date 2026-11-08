/**
 * Le seuil qui bloque et la cible qui tire — deux nombres, deux rôles.
 *
 * Le dépôt n'avait qu'un seuil : 0,70 en local, 0,60 en CI (les runners
 * partagés mesurent ~25 points sous la production réelle). Le relever à la cible
 * souhaitée aurait rendu chaque run rouge, donc désactivé le garde. Ces cas
 * tiennent les deux ensemble, et surtout ils tiennent le refus : un score
 * illisible n'est jamais un score suffisant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PERF_TARGET, PERF_THRESHOLD, perfVerdict } from '../scripts/lib/perf-target.mjs';

describe('verdict de performance — seuil et cible séparés', () => {
  it('la cible est 0,90 et le seuil 0,70 : deux nombres distincts', () => {
    assert.equal(PERF_TARGET, 0.9);
    assert.equal(PERF_THRESHOLD, 0.7);
  });

  it('sous le seuil : bloqué, même si la cible est loin', () => {
    const verdict = perfVerdict(0.55);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.meetsTarget, false);
    assert.equal(verdict.pct, 55);
    assert.match(verdict.message, /manqué/);
  });

  it('entre le seuil et la cible : autorisé, et l’écart est nommé en points', () => {
    const verdict = perfVerdict(0.84);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.meetsTarget, false);
    assert.equal(verdict.gapPct, 6);
    assert.match(verdict.message, /cible 90 manquée de 6 point/);
  });

  it('cible atteinte : les deux sont verts et il ne reste rien à gagner', () => {
    const verdict = perfVerdict(0.93);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.meetsTarget, true);
    assert.equal(verdict.gapPct, 0);
    assert.match(verdict.message, /cible 90 atteinte/);
  });

  it('un score ABSENT ou hors bornes est un refus nommé, jamais un vert', () => {
    for (const broken of [null, undefined, Number.NaN, -0.1, 1.5, 'excellent']) {
      const verdict = perfVerdict(broken);
      assert.equal(verdict.invalid, true, `${String(broken)} doit être refusé`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.pct, null);
      assert.match(verdict.message, /score illisible/);
    }
  });

  it('seuil et cible se règlent séparément — la CI garde son seuil bas sans toucher la cible', () => {
    const verdict = perfVerdict(0.62, { threshold: 0.6, target: 0.9 });
    assert.equal(verdict.ok, true, '0,60 en CI autorise le déploiement');
    assert.equal(verdict.meetsTarget, false, 'la cible reste 0,90, elle ne s’abaisse pas avec le seuil');
    assert.equal(verdict.gapPct, 28);
  });
});
