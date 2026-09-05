/**
 * Regenerate supabase/FULL_SETUP_MIGRATION.sql from the ordered migrations.
 *
 * The migrations in supabase/migrations/ are the single source of truth for
 * the schema. Each file is named <YYYYMMDDHHMMSS>_<name>.sql and they are
 * applied sequentially. Concatenating them in filename order reproduces, on a
 * fresh database, exactly the schema that sequential application produces —
 * so the "full setup" snapshot can never drift from the migrations again.
 *
 * Usage:
 *   node supabase/regenerate-full-setup.mjs            # (re)write the snapshot
 *   node supabase/regenerate-full-setup.mjs --check    # exit 1 if out of date
 *
 * The output is deterministic (no timestamp embedded), so `--check` is safe
 * to run in CI after every change to supabase/migrations/.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read a text file with line endings normalized to \n so comparisons and the
// generated snapshot are identical on LF and CRLF checkouts (no .gitattributes,
// core.autocrlf=true on Windows => working-tree files can be CRLF).
function readNormalized(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');
const SNAPSHOT_PATH = join(HERE, 'FULL_SETUP_MIGRATION.sql');
const SEPARATOR =
  '-- ============================================================================\n';

function buildHeader(files) {
  const listed = files.map((f) => `--   ${f}`).join('\n');
  return [
    SEPARATOR.trimEnd(),
    '-- COMPLEXE SCOLAIRE MAMA THERA — COMPLETE SUPABASE DATABASE SETUP SCRIPT',
    '-- ============================================================================',
    '--',
    '-- ⚠️  FICHIER GÉNÉRÉ AUTOMATIQUEMENT — NE PAS MODIFIER À LA MAIN.',
    '-- Source de vérité : supabase/migrations/ (migrations ordonnées).',
    '-- Toute évolution de schéma passe par une NOUVELLE migration ordonnée,',
    '-- puis ce snapshot est régénéré (voir git log pour la date de génération).',
    '--',
    `-- Régénération :  node supabase/regenerate-full-setup.mjs`,
    `-- Vérification :  node supabase/regenerate-full-setup.mjs --check`,
    '--',
    `-- Ce script est la concaténation des ${files.length} migrations suivantes, dans`,
    '-- l\'ordre chronologique de leur nom de fichier :',
    '--',
    listed,
    '--',
    '-- Exécuté dans le Supabase SQL Editor, il recrée le schéma complet',
    '-- (tables, index, fonctions, triggers, politiques RLS, données de',
    '-- référence) en UNE exécution.',
    SEPARATOR.trimEnd(),
    '',
  ].join('\n');
}

function buildSnapshot(files) {
  const parts = [buildHeader(files)];
  for (const file of files) {
    const sql = readNormalized(join(MIGRATIONS_DIR, file)).trimEnd();
    parts.push(
      `${SEPARATOR}-- MIGRATION : ${file}\n${SEPARATOR}\n${sql}\n`,
    );
  }
  return parts.join('\n');
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort(); // fixed-width YYYYMMDDHHMMSS prefix => lexical order == chronological

if (files.length === 0) {
  console.error(`No *.sql migration found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const generated = buildSnapshot(files);

if (process.argv.includes('--check')) {
  let current;
  try {
    current = readNormalized(SNAPSHOT_PATH);
  } catch {
    console.error(`Missing snapshot: ${SNAPSHOT_PATH} (run the generator first)`);
    process.exit(1);
  }
  if (current === generated) {
    console.log(`✓ ${SNAPSHOT_PATH} is in sync with ${files.length} migrations`);
    process.exit(0);
  }
  const cur = current.split('\n');
  const gen = generated.split('\n');
  let firstDiff = -1;
  for (let i = 0; i < Math.max(cur.length, gen.length); i++) {
    if (cur[i] !== gen[i]) {
      firstDiff = i + 1;
      break;
    }
  }
  console.error(
    `✗ ${SNAPSHOT_PATH} is OUT OF DATE (first difference at line ${firstDiff}). ` +
      `Run: node supabase/regenerate-full-setup.mjs`,
  );
  process.exit(1);
}

writeFileSync(SNAPSHOT_PATH, generated);
console.log(
  `✓ ${SNAPSHOT_PATH} regenerated from ${files.length} migrations ` +
    `(${(generated.length / 1024).toFixed(1)} KiB)`,
);
