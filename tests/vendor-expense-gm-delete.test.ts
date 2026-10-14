/**
 * Suite for `20260906000002_vendor_expense_gm_policies.sql` — la moitié DELETE,
 * appliquée le 2026-10-13 pour que le **Gestionnaire Principal** puisse supprimer
 * une dépense fournisseur.
 *
 * ─── Le défaut, mesuré ──────────────────────────────────────────────────────
 * La migration écrite le 2026-09-06 ouvrait l'INSERTION **et** la SUPPRESSION de
 * `vendor_expenses` aux finance admins ; elle n'a jamais été appliquée. Son
 * INSERT jumeau a été livré le 2026-10-13 sous une règle plus large
 * (`20261014000000_finance_writer_staff_vendor.sql`, `is_finance_writer()`, qui
 * ajoute l'économe), mais la SUPPRESSION est restée fermée : `check:rls-policies`
 * lisait, en base de l'école, « Finance admins delete vendor_expenses » ABSENTE
 * et DEUX noms hérités EN TROP (« Admin can delete vendor_expenses », qu'aucune
 * migration ne déclare, et « Promoter delete vendor_expenses », `is_admin()`).
 * L'écran montrait pourtant la corbeille au Gestionnaire Principal depuis
 * `20260902000000` : sa suppression était refusée par Postgres (42501) ou rendait
 * zéro ligne — le même défaut app↔base, dans la même table, cinq semaines plus tard.
 *
 * ─── Ce que ce fichier verrouille ───────────────────────────────────────────
 *   1. le jeu des `DROP` est FIGÉ : les deux noms hérités que la base portait,
 *      plus le nom que la migration crée (elle se rejoue) — et rien d'autre ;
 *   2. une SEULE policy est créée, c'est la SUPPRESSION par `is_finance_admin()` ;
 *      la moitié INSERTION supplantée n'est PAS recréée (sinon on aurait de
 *      nouveau deux noms pour la même écriture, et `db:apply` refuserait le
 *      fichier — c'est mesuré ci-dessous) ;
 *   3. ce que `npm run db:apply` exigera AVANT et vérifiera APRÈS, par le module
 *      PUR (`scripts/lib/apply-migration.mjs`) : un ajout absent, deux retraits
 *      présents, et les deux refus (déjà là / déjà absente).
 *
 * Ce que ce fichier ne prouve PAS : que la base porte cet état — c'est le métier
 * de `npm run check:rls-policies` et de `db:apply`, qui écrivent et relisent. Ici
 * on juge le TEXTE et le verdict, sans base.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyVerdict,
  declaredObjects,
  objectKeys,
  removalKeys,
} from '../scripts/lib/apply-migration.mjs';
// Les commentaires de cette migration NOMMENT les noms hérités (c'est son sujet) :
// un contrôle qui lit la prose comme du code se contenterait de se lire lui-même.
import { blankComments } from '../scripts/lib/schema-expected.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const MIGRATION_NAME = '20260906000002_vendor_expense_gm_policies.sql';
const sql = readFileSync(join(MIGRATIONS, MIGRATION_NAME), 'utf8');
const executed = blankComments(sql);

/** Les deux noms hérités mesurés en base le 2026-10-13 — tous deux `is_admin()`. */
const LEGACY_DELETE_POLICIES = ['Admin can delete vendor_expenses', 'Promoter delete vendor_expenses'];
const DECLARED_DELETE_POLICY = 'Finance admins delete vendor_expenses';

// ─── Le texte : ce qui part, ce qui arrive ───────────────────────────────────

describe('la migration de septembre, telle qu’elle est appliquée', () => {
  it('retire EXACTEMENT les deux noms hérités et le nom qu’elle crée (jeu figé)', () => {
    const dropped = [...executed.matchAll(/DROP POLICY IF EXISTS "([^"]+)" ON public\.vendor_expenses;/g)]
      .map((match) => match[1]!)
      .sort();
    assert.deepEqual(
      dropped,
      [...LEGACY_DELETE_POLICIES, DECLARED_DELETE_POLICY].sort(),
      'un nom hérité oublié resterait actif (les policies se cumulent par OR), un retrait ajouté retirerait une RÈGLE',
    );
  });

  it('crée UNE seule policy : la suppression par public.is_finance_admin()', () => {
    const created = [...executed.matchAll(/CREATE POLICY "([^"]+)" ON public\.vendor_expenses[\s\S]*?;/g)];
    assert.equal(created.length, 1, 'une seule policy créée — sinon l’écriture supplantée revient par la porte de derrière');
    const statement = created[0]![0];
    assert.match(statement, new RegExp(`CREATE POLICY "${DECLARED_DELETE_POLICY}"`));
    assert.match(
      statement,
      /FOR DELETE TO authenticated\s+USING \(public\.is_finance_admin\(\)\)/,
      'la règle NOMMÉE est celle que l’app lit (`canDeleteVendorExpenses`)',
    );
  });

  it('ne recrée JAMAIS la moitié INSERTION supplantée par 20261014000000', () => {
    assert.doesNotMatch(executed, /FOR INSERT|WITH CHECK/i, 'aucune policy d’insertion dans ce fichier');
    assert.equal(
      executed.includes('Finance admins insert vendor_expenses'),
      false,
      'le SECOND nom de l’écriture (retiré par 20261014000000) ne revient pas ici',
    );
    assert.equal(
      executed.includes('Promoter insert vendor_expenses'),
      false,
      'et l’ancien nom d’insertion n’est plus retiré ici : 20261014000000 l’a fait',
    );
  });

  it('ne touche à AUCUNE autre table', () => {
    const tables = [...executed.matchAll(/ON public\.([a-z_]+)/gi)].map((match) => match[1]!.toLowerCase());
    assert.ok(tables.length >= 4, `le contrôle lit bien les instructions (${tables.length} trouvées)`);
    assert.deepEqual([...new Set(tables)], ['vendor_expenses']);
  });

  it('l’aide que la policy appelle est celle de 20260902000000 — pas redéfinie ici', () => {
    assert.doesNotMatch(executed, /CREATE (OR REPLACE )?FUNCTION/i, 'cette migration ne (re)définit aucune fonction');
    const roleMigration = readFileSync(join(MIGRATIONS, '20260902000000_general_manager_role.sql'), 'utf8');
    assert.match(roleMigration, /CREATE OR REPLACE FUNCTION public\.is_finance_admin\(\)/);
    assert.match(roleMigration, /role IN \('admin', 'dev', 'general_manager'\)/);
  });
});

// ─── Ce que db:apply exigera, et ce qu’il refusera ───────────────────────────

describe('db:apply — un ajout absent, deux retraits présents (2026-10-13)', () => {
  const objects = declaredObjects(sql);
  const keys = objectKeys(objects);
  const removals = removalKeys(objects);

  it('déclare exactement un ajout et deux retraits de POLICY', () => {
    assert.deepEqual(keys, [`policy:${DECLARED_DELETE_POLICY}`]);
    assert.deepEqual(removals, LEGACY_DELETE_POLICIES.map((name) => `policy:${name}`).sort());
    assert.deepEqual(objects.tables, [], 'aucune colonne à relire : le geste est une politique');
    assert.deepEqual(objects.functions, [], 'et aucune fonction à déclarer');
  });

  it('le seul verdict vert : présents AVANT, absent APRÈS — et l’inverse est un refus', () => {
    const clean = applyVerdict({ objects, before: new Set(removals), after: new Set(keys) });
    assert.equal(clean.ok, true, 'les deux noms hérités présents avant, partis après : le seul cas vert');
    assert.deepEqual(clean.stillThere, []);
    assert.deepEqual(clean.goneAlready, []);
    assert.deepEqual(clean.already, []);
  });

  it('un nom hérité déjà ABSENT avant : refus (le retrait ne prouverait rien)', () => {
    const verdict = applyVerdict({
      objects,
      before: new Set([`policy:${LEGACY_DELETE_POLICIES[1]!}`]),
      after: new Set(keys),
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.goneAlready, [`policy:${LEGACY_DELETE_POLICIES[0]!}`]);
    assert.match(verdict.problems.join(' '), /déjà ABSENT avant/);
  });

  it('le nom déclaré déjà en base AVANT : refus (le fichier serait déjà appliqué)', () => {
    const verdict = applyVerdict({
      objects,
      before: new Set([...removals, `policy:${DECLARED_DELETE_POLICY}`]),
      after: new Set(keys),
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.already, [`policy:${DECLARED_DELETE_POLICY}`]);
    assert.match(verdict.problems.join(' '), /déjà en base AVANT/);
  });

  it('un nom hérité resté EN PLACE après : retrait non vérifié', () => {
    const verdict = applyVerdict({
      objects,
      before: new Set(removals),
      after: new Set([keys[0]!, removals[0]!]),
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.stillThere, [removals[0]]);
    assert.match(verdict.problems.join(' '), /retrait NON vérifié APRÈS/);
  });
});
