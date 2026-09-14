/**
 * Suite for the staff KIND — which of the three members a row is.
 *
 * What it locks down, and why each case exists:
 *
 *   1. THE KIND IS A FACT, NOT A GUESS. Before migration 20260914000000 the kind
 *      had no home in the schema: it was decided at render time by matching the
 *      free-text `position` against the curated label lists, in whichever
 *      language the form had been filled in. Measured consequences: a member
 *      added through "Ajouter un Membre du Centre T et P" with a typed position
 *      outside those lists downloaded the EMPLOYEE fiche, and editing a position
 *      moved a member from one document to another. Row #2 proves the explicit
 *      category wins even when the prose contradicts it; row #3 proves a row
 *      written before the column still answers the way it always rendered.
 *
 *   2. THE BACKFILL CANNOT DRIFT FROM THE LISTS. The migration classifies
 *      existing rows with its own copy of the curated labels — the only copy
 *      that can run in SQL. If someone adds a role to ADMIN_POSITIONS and not to
 *      the migration, rows of that role silently become employees. The last case
 *      compares the two sets in BOTH directions, so the drift is caught here
 *      instead of on a school's payroll.
 *
 *   3. EACH KIND HAS ITS OWN PAPER. One template per kind, present on disk and
 *      distinct — a missing template would hand an entire category a broken
 *      document.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ADMIN_POSITIONS,
  TECH_POSITIONS,
  STAFF_CATEGORIES,
  isStaffCategory,
  staffCategory,
} from '../src/lib/adminPositions';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(root, 'supabase/migrations/20260914000000_staff_category.sql');

describe('staffCategory — la catégorie est un fait', () => {
  it('une catégorie explicite répond, même quand le poste la contredit', () => {
    assert.equal(staffCategory({ category: 'technique', position: 'Proviseur' }), 'technique');
    assert.equal(staffCategory({ category: 'admin', position: 'Agent technique polyvalent' }), 'admin');
    assert.equal(staffCategory({ category: 'employee', position: 'Technicien' }), 'employee');
  });

  it('les trois kinds que les trois flux écrivent sont les trois valeurs admises', () => {
    assert.deepEqual([...STAFF_CATEGORIES], ['employee', 'technique', 'admin']);
    for (const value of STAFF_CATEGORIES) assert.ok(isStaffCategory(value));
    for (const junk of ['', 'Employee', 'technicien', 'provider', null, undefined, 3]) {
      assert.equal(isStaffCategory(junk), false, `${String(junk)} n'est pas une catégorie`);
    }
  });

  it('une ligne écrite AVANT la colonne répond comme elle s’affichait (les deux langues)', () => {
    for (const label of ADMIN_POSITIONS.fr) {
      assert.equal(staffCategory({ position: label }), 'admin', `${label} → administration`);
    }
    for (const label of ADMIN_POSITIONS.en) {
      assert.equal(staffCategory({ position: label }), 'admin', `${label} → administration`);
    }
    for (const label of TECH_POSITIONS.fr) {
      assert.equal(staffCategory({ position: label }), 'technique', `${label} → Centre T et P`);
    }
    for (const label of TECH_POSITIONS.en) {
      assert.equal(staffCategory({ position: label }), 'technique', `${label} → Centre T et P`);
    }
  });

  it('un poste libre, vide ou absent reste un employé — jamais un refus', () => {
    for (const position of ['Enseignant', 'Agent technique polyvalent', 'Comptable', '', '   ', null, undefined]) {
      assert.equal(staffCategory({ position }), 'employee', `${String(position)} → employé`);
    }
    assert.equal(staffCategory({}), 'employee', 'aucune donnée → employé');
  });

  it('une valeur inconnue dans la colonne n’est pas crue : le poste prend le relais', () => {
    // The CHECK constraint makes this impossible today; if it ever reaches us,
    // the fallback keeps the member's document working instead of labelling
    // them something the app cannot document.
    assert.equal(staffCategory({ category: 'Chef de service', position: 'Technicien' }), 'technique');
    assert.equal(staffCategory({ category: 'Chef de service', position: 'Prof de maths' }), 'employee');
  });
});

describe('migration 20260914000000 — la colonne et son reclassement', () => {
  it('déclare la colonne NOT NULL avec les trois seules valeurs admises', async () => {
    const sql = await readFile(MIGRATION, 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'employee'/);
    assert.match(sql, /CHECK \(category IN \('employee', 'technique', 'admin'\)\)/);
  });

  it('reclasse avec EXACTEMENT les libellés des listes du code, dans les deux sens', async () => {
    const sql = (await readFile(MIGRATION, 'utf8')).toLowerCase();
    const listOf = (marker: string): string[] => {
      const start = sql.indexOf(marker);
      assert.ok(start >= 0, `la migration contient « ${marker} »`);
      // The IN list itself — not the first parenthesis after the marker, which
      // would be `btrim(position)`.
      const listMarker = ' in (';
      const open = sql.indexOf(listMarker, start);
      const close = sql.indexOf(')', open);
      assert.ok(open >= 0 && close > open, `la liste « ${marker} » est fermée`);
      return sql
        .slice(open + listMarker.length, close)
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
    };

    const inMigration = {
      technique: listOf("set category = 'technique'"),
      admin: listOf("set category = 'admin'"),
    };
    const inCode = {
      technique: [...TECH_POSITIONS.fr, ...TECH_POSITIONS.en].map((p) => p.trim().toLowerCase()),
      admin: [...ADMIN_POSITIONS.fr, ...ADMIN_POSITIONS.en].map((p) => p.trim().toLowerCase()),
    };

    for (const kind of ['technique', 'admin'] as const) {
      const sqlSet = [...new Set(inMigration[kind])].sort();
      const codeSet = [...new Set(inCode[kind])].sort();
      const missingInSql = codeSet.filter((p) => !sqlSet.includes(p));
      const missingInCode = sqlSet.filter((p) => !codeSet.includes(p));
      assert.deepEqual(
        missingInSql,
        [],
        `ces libellés ${kind} du code ne sont pas reclassés par la migration (ils deviendraient employés)`,
      );
      assert.deepEqual(
        missingInCode,
        [],
        `ces libellés ${kind} de la migration ont disparu du code (le poste ne serait plus reconnu)`,
      );
    }
  });
});

describe('un document par kind — trois papiers distincts, présents', () => {
  const TEMPLATE_OF_KIND = {
    employee: { file: 'fiche-paiement-salaire.pdf', module: 'src/lib/pdfPayrollFiche.ts' },
    technique: { file: 'fiche-technique.pdf', module: 'src/lib/pdfPayrollTechnique.ts' },
    admin: { file: 'bulletin-paie-mensuelle.pdf', module: 'src/lib/pdfPayrollBulletin.ts' },
  } as const;

  it('chaque générateur charge son propre gabarit, et ce gabarit existe', async () => {
    const seen = new Set<string>();
    for (const [kind, { file, module }] of Object.entries(TEMPLATE_OF_KIND)) {
      assert.ok(existsSync(join(root, 'public/templates', file)), `${kind}: public/templates/${file} existe`);
      const source = await readFile(join(root, module), 'utf8');
      assert.ok(
        source.includes(file),
        `${module} charge bien son gabarit (${file}) — un document par kind, pas un générique`,
      );
      assert.equal(seen.has(file), false, `${file} ne sert qu'à un seul kind`);
      seen.add(file);
    }
    assert.equal(seen.size, 3, 'les trois kinds ont trois papiers différents');
  });
});
