/**
 * Suite for `scripts/lib/schema-expected.mjs` + `scripts/check-hosted-schema.mjs`.
 *
 * What it locks down, and why each case exists:
 *
 *   1. LA PROSE N'EST PAS DU CODE. Les commentaires des migrations parlent
 *      littéralement de colonnes (« … puis dropper la colonne `category` »).
 *      `blankComments` les blanchit — et doit garder la LONGUEUR, pour qu'un
 *      décalage trouvé désigne la même ligne du fichier d'origine.
 *
 *   2. LE FAUX VERT EST DÉJÀ ARRIVÉ, ici. La boucle qui retire une colonne
 *      absente pour nommer les suivantes a été écrite une première fois en
 *      jugeant sur « le dernier essai a réussi » : or l'essai d'après réussit
 *      FORCÉMENT, donc la table était annoncée complète alors qu'il lui manquait
 *      une colonne. Attrapé par la première preuve du rouge sur la base réelle,
 *      il est verrouillé ici par une sonde fabriquée — sans toucher à une base.
 *
 *   3. DEUX FORMES MESURÉES POUR LA MÊME ABSENCE. PostgREST répond `PGRST204`
 *      (« Could not find the 'x' column of 'y' ») quand c'est son cache de schéma
 *      qui refuse, et laisse passer l'erreur de PostgreSQL — `42703`, « column
 *      y.x does not exist » — quand c'est la base. Les deux ont été vues sur la
 *      base partagée le 2026-09-14 ; ne reconnaître que la première aurait classé
 *      un vrai retard en « invérifiable ».
 *
 *   4. UN STATUT INCONNU N'EST JAMAIS UN VERT (401, 500, réseau coupé, sonde qui
 *      échoue) : le jugement doit le rendre « non jugée », jamais « présent ».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  blankComments,
  expectedSchemaFromMigrations,
  interpretProbe,
  judgeHostedSchema,
} from '../scripts/lib/schema-expected.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

describe('blankComments — lire du SQL, pas de la prose', () => {
  it('blanchit un commentaire de ligne, un commentaire de bloc et un littéral', () => {
    // Les mots de prose sont distincts des identifiants du CODE, sinon le cas
    // mesurerait sa propre confusion : `category` est ici une colonne, donc le
    // retrouver n'apprend rien. Ce sont les marques de la prose qui doivent
    // disparaître, et elles seules.
    const sql = [
      'ALTER TABLE public.staff',
      "  ADD COLUMN note TEXT DEFAULT 'a,PROSE_LIT' -- PROSE_LIGNE category",
      '  /* PROSE_BLOC */,',
      '  ADD COLUMN tag TEXT;',
    ].join('\n');
    const blanked = blankComments(sql);

    assert.equal(blanked.length, sql.length, 'la longueur ne bouge pas (un décalage désigne la même ligne)');
    assert.equal(blanked.split('\n').length, sql.split('\n').length, 'les sauts de ligne restent');
    assert.equal(/PROSE_LIGNE/.test(blanked), false, 'la prose d’un commentaire de ligne a disparu');
    assert.equal(/PROSE_BLOC/.test(blanked), false, 'la prose d’un commentaire de bloc a disparu');
    assert.equal(/PROSE_LIT/.test(blanked), false, 'le contenu d’un littéral a disparu');
    assert.equal(/a,/.test(blanked), false, 'la virgule du littéral ne découpe plus rien');
    assert.ok(blanked.includes('ADD COLUMN note TEXT'), 'le code, lui, reste lisible');
    assert.ok(blanked.includes('ADD COLUMN tag TEXT'), 'et le code APRÈS le littéral et le bloc aussi');
  });

  it('gère une apostrophe doublée (elle ne termine pas le littéral)', () => {
    const sql = "ALTER TABLE staff ADD COLUMN x TEXT DEFAULT 'l''heure' , ADD COLUMN y TEXT;";
    const blanked = blankComments(sql);
    assert.equal(blanked.length, sql.length);
    assert.ok(blanked.includes('ADD COLUMN y TEXT'), 'le code après le littéral est toujours lu');
  });
});

describe('expectedSchemaFromMigrations — ce que les migrations déclarent', () => {
  const parse = (sql: string) => expectedSchemaFromMigrations([{ name: 'x.sql', sql }]);

  it('lit les colonnes d’un CREATE TABLE et ignore les contraintes de table', () => {
    const tables = parse(`
      CREATE TABLE IF NOT EXISTS public.staff (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        salary NUMERIC NOT NULL,
        UNIQUE (name),
        CONSTRAINT staff_salary_positive CHECK (salary >= 0)
      );
    `);
    assert.deepEqual([...tables.get('staff')!].sort(), ['id', 'name', 'salary']);
  });

  it('lit ADD COLUMN, plusieurs fois dans une même instruction, et DROP COLUMN', () => {
    const tables = parse(`
      ALTER TABLE public.staff
        ADD COLUMN IF NOT EXISTS inps_number TEXT,
        ADD COLUMN hire_date DATE,
        ADD COLUMN then_removed TEXT;
      ALTER TABLE public.staff DROP COLUMN IF EXISTS then_removed;
      ALTER TABLE public.staff ADD CONSTRAINT staff_check CHECK (salary > 0);
      ALTER TABLE public.staff ALTER COLUMN salary SET DEFAULT 0;
    `);
    const columns = [...tables.get('staff')!].sort();
    assert.deepEqual(columns, ['hire_date', 'inps_number'], 'les contraintes et les ALTER ne sont pas des colonnes');
  });

  it('la prose qui nomme une colonne ne crée pas de colonne', () => {
    const tables = parse(`
      -- Ajouter ensuite une colonne imaginaire et un index
      ALTER TABLE public.staff ADD COLUMN real_one TEXT;
    `);
    assert.deepEqual([...tables.get('staff')!], ['real_one']);
  });

  it('une DROP TABLE retire la table, même dans un bloc conditionnel', () => {
    const tables = parse(`
      CREATE TABLE public.custom_grades (id UUID, name TEXT);
      CREATE TABLE public.custom_classes (id UUID, code TEXT);
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'custom_grades') THEN
          DROP TABLE public.custom_grades;
        END IF;
      END
      $$;
    `);
    assert.equal(tables.has('custom_grades'), false, 'la table supprimée n’est plus attendue');
    assert.deepEqual([...tables.get('custom_classes')!].sort(), ['code', 'id']);
  });

  it('accumule les migrations dans l’ordre, la dernière écriture gagne', () => {    const tables = expectedSchemaFromMigrations([
      { name: '1.sql', sql: 'CREATE TABLE public.t (id UUID, gone TEXT);' },
      { name: '2.sql', sql: 'ALTER TABLE public.t DROP COLUMN gone, ADD COLUMN added TEXT;' },
    ]);
    assert.deepEqual([...tables.get('t')!].sort(), ['added', 'id']);
  });

  it('un DROP puis un CREATE dans le MÊME fichier : c’est le CREATE qui tient', () => {
    const tables = parse(`
      DROP TABLE IF EXISTS public.legacy;
      CREATE TABLE public.legacy (id UUID, fresh TEXT);
    `);
    assert.deepEqual([...tables.get('legacy')!].sort(), ['fresh', 'id'], 'recréer une table la remet à sa nouvelle forme');
  });

  it('lit le VRAI corpus : la bonne colonne, la bonne table absente', () => {
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
    const tables = expectedSchemaFromMigrations(
      files.map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') })),
    );
    assert.ok(files.length >= 20, `les migrations du dépôt sont lues (${files.length})`);
    assert.ok(tables.size >= 10, `au moins dix tables déclarées (${tables.size})`);
    assert.ok(tables.get('staff')?.has('category'), 'staff.category est déclarée par une migration');
    assert.equal(tables.has('custom_grades'), false, 'custom_grades est retirée par une migration');
    assert.equal(tables.has('probe_absent_column'), false, 'aucune table inventée');
  });
});

describe('interpretProbe — ce qu’une réponse dit de la sonde', () => {
  it('un 2xx est le seul « tout est là »', () => {
    for (const status of [200, 206, 204]) {
      assert.equal(interpretProbe({ status, body: null }).verdict, 'ok');
    }
  });

  it('nomme la colonne absente, dans les DEUX formes mesurées', () => {
    const fromCache = interpretProbe({
      table: 'staff',
      status: 400,
      body: { code: 'PGRST204', message: "Could not find the 'category' column of 'staff' in the schema cache" },
    });
    assert.equal(fromCache.verdict, 'missing-column');
    assert.equal(fromCache.column, 'category');
    assert.equal(fromCache.table, 'staff');

    const fromDatabase = interpretProbe({
      table: 'staff',
      status: 400,
      body: { code: '42703', message: 'column staff.probe_absent_column does not exist' },
    });
    assert.equal(fromDatabase.verdict, 'missing-column');
    assert.equal(fromDatabase.column, 'probe_absent_column');
    assert.equal(fromDatabase.table, 'staff');
  });

  it('nomme la table absente', () => {
    assert.equal(
      interpretProbe({ status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.ghost' in the schema cache" } })
        .verdict,
      'missing-table',
    );
    assert.equal(
      interpretProbe({ status: 400, body: { code: '42P01', message: 'relation "ghost" does not exist' } }).verdict,
      'missing-table',
    );
  });

  it('un statut qu’il ne sait pas lire n’est jamais un vert', () => {
    for (const body of [null, 'Internal Server Error', { message: "JWT expired" }]) {
      for (const status of [0, 401, 403, 500, 503]) {
        const reading = interpretProbe({ status, body });
        assert.equal(reading.verdict, 'unknown', `statut ${status} non interprétable`);
        assert.notEqual(reading.verdict, 'ok');
      }
    }
  });
});

describe('judgeHostedSchema — le verdict, sonde fabriquée', () => {
  /** Une sonde qui imite PostgREST : 200 si toutes les colonnes existent, 42703 pour la première inconnue. */
  function fakeProbe(known: Record<string, string[]>) {
    const asked: Array<{ table: string; columns: string[] }> = [];
    const probe = async (table: string, columns: string[]) => {
      asked.push({ table, columns: [...columns] });
      const real = known[table];
      if (!real) {
        return { status: 404, body: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
      }
      const missing = columns.find((column) => !real.includes(column));
      if (missing) {
        return { status: 400, body: { code: '42703', message: `column ${table}.${missing} does not exist` } };
      }
      return { status: 200, body: null };
    };
    return { probe, asked };
  }

  const expected = new Map([
    ['staff', new Set(['id', 'name', 'category'])],
    ['payments', new Set(['id', 'amount'])],
  ]);

  it('vert quand la base porte tout', async () => {
    const { probe } = fakeProbe({ staff: ['id', 'name', 'category'], payments: ['id', 'amount'] });
    const verdict = await judgeHostedSchema({ expected, probe });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.missing, []);
    assert.deepEqual(verdict.missingTables, []);
    assert.deepEqual(verdict.unverifiable, []);
  });

  it('UNE colonne absente fait ROUGIR la table — le faux vert n’est pas de retour', async () => {
    // C'est le cas d'origine : la colonne manque, on la retire, l'essai d'après
    // réussit. Juger sur ce succès annonçait « toutes présentes ».
    const { probe, asked } = fakeProbe({ staff: ['id', 'name'], payments: ['id', 'amount'] });
    const verdict = await judgeHostedSchema({ expected, probe });

    const staff = verdict.results.find((r) => r.table === 'staff')!;
    assert.equal(staff.verdict, 'missing-columns', 'la table est en retard, pas complète');
    assert.deepEqual(staff.gone, ['category'], 'la colonne manquante est nommée');
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.results.find((r) => r.table === 'payments')!.verdict, 'ok');
    assert.ok(asked.length >= 3, 'la question est reposée après avoir retiré la colonne');
  });

  it('PLUSIEURS colonnes absentes sont TOUTES nommées', async () => {
    const { probe } = fakeProbe({ staff: ['id'], payments: ['id', 'amount'] });
    const verdict = await judgeHostedSchema({ expected, probe });
    const staff = verdict.results.find((r) => r.table === 'staff')!;
    assert.deepEqual([...staff.gone].sort(), ['category', 'name'], 'aucune colonne manquante n’est cachée');
  });

  it('une table absente est un retard de schéma, pas un silence', async () => {
    const { probe } = fakeProbe({ staff: ['id', 'name', 'category'] });
    const verdict = await judgeHostedSchema({ expected, probe });
    assert.deepEqual(verdict.missingTables.map((r) => r.table), ['payments']);
    assert.equal(verdict.ok, false);
  });

  it('une sonde qui échoue rend « non jugée », jamais « présente »', async () => {
    const failing = async () => {
      throw new Error('fetch failed');
    };
    const verdict = await judgeHostedSchema({ expected, probe: failing });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.unverifiable.length, 2, 'les deux tables sont déclarées non jugées');
    assert.ok(verdict.unverifiable.every((r) => r.verdict === 'unknown'));
  });

  it('ne boucle pas indéfiniment quand rien ne répond 200', async () => {
    let calls = 0;
    const stubborn = async (table: string, columns: string[]) => {
      calls += 1;
      return { status: 400, body: { code: '42703', message: `column ${table}.${columns[0]} does not exist` } };
    };
    const verdict = await judgeHostedSchema({ expected, probe: stubborn });
    assert.equal(verdict.ok, false);
    assert.ok(calls <= 8, `la boucle est bornée par le nombre de colonnes (${calls} appels)`);
    assert.equal(verdict.results.find((r) => r.table === 'staff')!.gone.length, 3, 'les trois colonnes sont nommées');
  });
});
