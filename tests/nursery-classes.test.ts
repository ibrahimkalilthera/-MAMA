/**
 * Les classes CR (crèche / jardin d'enfants — Petit, Moyen, Grand) sont écrites
 * DEUX fois, et c'est volontaire :
 *
 *   • dans l'application (`DEFAULT_SCHOOL_CLASSES`, cycle Maternelle / Jardin
 *     d'Enfants) pour que le poste les connaisse, filtres et formulaire
 *     compris, sans dépendre du réseau ;
 *   • dans `custom_classes` (migration 20260914000002) pour qu'un poste dont le
 *     build ne les embarque PAS ENCORE — une application de bureau installée sur
 *     une version antérieure — les voie quand même à la connexion.
 *
 * Deux écritures qui ne s'accordent que le jour où on les écrit, c'est
 * exactement la panne que ce dépôt traque : ce test relit donc les DEUX sources
 * et échoue à la première divergence, dans un sens comme dans l'autre (une
 * classe déclarée mais jamais semée, une classe semée que l'app ne déclare pas).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_SCHOOL_CLASSES, NURSERY_CYCLE } from '../src/app/types';

const MIGRATION = 'supabase/migrations/20260914000002_nursery_classes.sql';

interface SeededClass {
  code: string;
  cycle: string;
  year: string;
  section: string;
  nameFr: string;
  nameEn: string;
}

/** Les lignes `(code, cycle, year, section, name_fr, name_en)` du INSERT. */
function seededClasses(sql: string): SeededClass[] {
  const insert = sql.match(/INSERT INTO public\.custom_classes[^;]*?VALUES([\s\S]*?)ON CONFLICT/);
  assert.ok(insert, 'la migration doit semer les classes par un INSERT … VALUES … ON CONFLICT');
  return [
    ...insert![1].matchAll(
      /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
    ),
  ].map((m) => ({ code: m[1], cycle: m[2], year: m[3], section: m[4], nameFr: m[5], nameEn: m[6] }));
}

/** Les mêmes lignes, dérivées des classes que l'application déclare. */
function appClasses(): SeededClass[] {
  return DEFAULT_SCHOOL_CLASSES.filter((c) => c.cycle === NURSERY_CYCLE).map((c) => ({
    code: c.id,
    cycle: c.cycle,
    year: String(c.year),
    section: c.section,
    nameFr: c.nameFr,
    nameEn: c.nameEn,
  }));
}

describe('classes CR (crèche / jardin d’enfants)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('l’application déclare exactement Petit, Moyen, Grand dans le cycle CR', () => {
    assert.deepEqual(
      appClasses().map((c) => c.code),
      ['CR-PETIT', 'CR-MOYEN', 'CR-GRAND'],
      'les trois classes du flux « Ajouter CR », dans l’ordre Petit → Moyen → Grand',
    );
  });

  it('la migration sème EXACTEMENT les classes que l’app déclare (mêmes libellés, même cycle)', () => {
    assert.deepEqual(seededClasses(sql), appClasses());
  });

  it('le seed est idempotent et refuse une exécution incomplète', () => {
    assert.match(sql, /ON CONFLICT DO NOTHING/, 'une seconde exécution ne doit rien dupliquer');
    assert.match(sql, /RAISE EXCEPTION/, 'un seed incomplet doit échouer, pas passer en silence');
  });
});
