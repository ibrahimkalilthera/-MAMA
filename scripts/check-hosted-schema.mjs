#!/usr/bin/env node
/**
 * ─── La base hébergée porte-t-elle ce que les migrations déclarent ? ─────────
 *
 *   npm run check:hosted-schema            (dans la CI, avant tout déploiement)
 *   npm run check:hosted-schema -- --url https://ref.supabase.co
 *
 * ─── Pourquoi ce contrôle existe ─────────────────────────────────────────────
 * Le 2026-09-14, la colonne `staff.category` a été écrite dans le code AVANT
 * d'exister dans la base hébergée. Mesuré : `select=category` → 400, et tout
 * AJOUT d'employé aurait été refusé (PostgREST refuse une colonne inconnue).
 * Le déploiement, lui, serait parti vert : la chaîne qualité ne lit que le
 * dépôt, les migrations sont appliquées à la main (CLI/Dashboard Supabase), et
 * rien ne comparait les deux. C'est la forme d'échec la plus coûteuse de ce
 * dépôt — un vert qui ne vérifie rien.
 *
 * ─── Ce qu'il compare, et par quel canal ─────────────────────────────────────
 * Ce que les migrations DÉCLARENT (déduit de `supabase/migrations/`, la source
 * de vérité dont `db:snapshot:check` prouve déjà la cohérence) contre ce que la
 * base RÉPOND. La sonde est PostgREST — le canal de l'application elle-même :
 * `GET /rest/v1/<table>?select=<colonnes>&limit=0`. PostgREST résout les
 * colonnes AVANT d'appliquer la RLS, donc une réponse 200 prouve que les
 * colonnes EXISTENT, sans lire une seule ligne.
 *
 * C'est pourquoi ce contrôle ne demande aucun secret : la clé `anon` suffit
 * (`VITE_SUPABASE_ANON_KEY`, celle qui est embarquée dans le client), et c'est
 * la clé du parc réel. Aucune donnée n'est lue, aucune écriture n'est faite,
 * aucune colonne tombée n'est modifiée. Il ne nomme que des NOMS de colonnes.
 *
 * ─── Ce qu'il refuse de faire passer pour un vert ────────────────────────────
 *   • aucun corpus lu (0 migration, 0 table, une table sans colonne) ⇒ sortie 2 ;
 *   • aucune base à interroger (URL ou clé absente) ⇒ sortie 2, en le disant ;
 *   • une réponse qu'il ne sait pas interpréter (401, 500, réseau) ⇒ sortie 2.
 * Dans les trois cas, « je n'ai pas pu regarder » n'est PAS « tout va bien ».
 *
 * Sortie : 0 = la base porte tout ce que les migrations déclarent ; 1 = elle est
 * en retard (le retard est nommé, table par table, colonne par colonne) ;
 * 2 = pas de verdict possible.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARED_PROJECT_REF, SHARED_PROJECT_URL, projectRefOf } from './lib/shared-project.mjs';
import { expectedSchemaFromMigrations, judgeHostedSchema } from './lib/schema-expected.mjs';
import { withTransientRetry } from './lib/transient-http.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

// ── Arguments ────────────────────────────────────────────────────────────────
const argValue = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage : npm run check:hosted-schema [-- --url <base>]');
  process.exit(0);
}

// ── Les fichiers d'environnement, lus sans `--env-file` ──────────────────────
// (le `--env-file` de Node tronque une valeur au premier `#` non quoté — le
// même piège que scripts/audit-user-profiles.mjs documente).
function parseEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch {
    return {};
  }
}
const dotEnv = { ...parseEnvFile(join(root, '.env')), ...parseEnvFile(join(root, '.env.production')) };

const baseUrl = (argValue('url') || process.env.VITE_SUPABASE_URL || dotEnv.VITE_SUPABASE_URL || SHARED_PROJECT_URL)
  .replace(/\/+$/, '');
const apiKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  dotEnv.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  dotEnv.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const usingAnon = Boolean(process.env.VITE_SUPABASE_ANON_KEY || dotEnv.VITE_SUPABASE_ANON_KEY);

// ── Ce que les migrations déclarent ──────────────────────────────────────────
let migrationFiles;
try {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
} catch {
  migrationFiles = [];
}
const expected = expectedSchemaFromMigrations(
  migrationFiles.map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') })),
);

// Rien lu n'est pas un vert : sans corpus, ce contrôle ne prouve rien, et le
// dire en sortant 0 serait exactement le défaut qu'il existe pour attraper.
if (migrationFiles.length === 0) {
  console.error(`❌ Aucune migration lue dans ${MIGRATIONS_DIR} — il n'y a rien à comparer.`);
  process.exit(2);
}
if (expected.size === 0 || [...expected.values()].some((columns) => columns.size === 0)) {
  console.error(
    `❌ ${migrationFiles.length} migration(s) lue(s) mais ${expected.size} table(s) et ` +
      `${[...expected.values()].filter((c) => c.size === 0).length} sans aucune colonne — ` +
      'la déduction ne peut pas juger ce qu\'elle n\'a pas su lire.',
  );
  process.exit(2);
}
if (!apiKey) {
  console.error(
    '❌ Aucune clé pour interroger la base (VITE_SUPABASE_ANON_KEY absente) — ' +
      "« je n'ai pas pu regarder » n'est pas un vert.",
  );
  process.exit(2);
}

// ── La sonde ─────────────────────────────────────────────────────────────────
/** Une requête PostgREST qui ne lit AUCUNE ligne : `limit=0`, colonnes validées. */
async function probe(table, columns) {
  const query = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=${columns.map(encodeURIComponent).join(',')}&limit=0`;
  return withTransientRetry(
    async () => {
      const response = await fetch(query, {
        headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20000),
      });
      // Le corps est lu pour les erreurs seulement : PostgREST y nomme la
      // colonne ou la table introuvable, et c'est ce nom qui est le verdict.
      const body = response.ok ? null : await response.json().catch(() => null);
      return { status: response.status, body };
    },
    { label: `sonde ${table}`, attempts: 3 },
  );
}

// Le verdict lui-même vit dans le module pur (et y est testé, avec une sonde
// fabriquée) : ici on sonde, on nomme, on sort.
const { results, missing, missingTables, unverifiable } = await judgeHostedSchema({ expected, probe });

for (const result of results) {
  if (result.verdict === 'ok') {
    console.log(`   ✅ ${result.table.padEnd(20)} ${result.declared.length} colonne(s) déclarée(s), toutes présentes`);
  } else if (result.verdict === 'missing-columns') {
    console.log(`   ❌ ${result.table.padEnd(20)} en retard : ${result.gone.join(', ')}`);
  } else if (result.verdict === 'missing-table') {
    console.log(`   ❌ ${result.table.padEnd(20)} ABSENTE en base (les migrations la créent)`);
  } else {
    console.log(`   ➖ ${result.table.padEnd(20)} non jugée — ${result.reason}`);
  }
}

const ref = projectRefOf(baseUrl) ?? baseUrl;
console.log(
  `\n🔎 schéma hébergé — ${expected.size} table(s) déclarée(s) par ${migrationFiles.length} migration(s), ` +
    `projet ${ref}${ref === SHARED_PROJECT_REF ? ' (base partagée)' : ' ⚠️ AUTRE projet'}`,
);
console.log(
  `ℹ️  sonde : ${usingAnon ? 'clé anon (aucun secret)' : 'clé service-role'} — ` +
    'les colonnes sont validées par PostgREST avant la RLS, aucune ligne n\'est lue.',
);

if (unverifiable.length > 0) {
  console.error(`\n❌ ${unverifiable.length} table(s) NON JUGÉE(S) — invérifiable n'est pas un vert :`);
  for (const item of unverifiable) console.error(`   • ${item.table} : ${item.reason}`);
  process.exit(2);
}

if (missing.length > 0 || missingTables.length > 0) {
  console.error(`\n❌ la base hébergée est EN RETARD sur les migrations — appliquez-les AVANT de déployer :`);
  for (const item of missing) {
    console.error(`   • ${item.table}.${item.gone.join(', ')}`);
    console.error(`     « ${item.reason} »`);
  }
  for (const item of missingTables) console.error(`   • table ${item.table} : « ${item.reason} »`);
  console.error(
    '\n   Appliquez la migration concernée sur le projet partagé (CLI/Dashboard Supabase) puis\n' +
      '   relancez ce contrôle : un déploiement dont le schéma manque casse un AJOUT, pas une lecture.',
  );
  process.exit(1);
}

console.log(
  `\n✅ la base hébergée porte tout ce que les ${migrationFiles.length} migrations déclarent ` +
    `(${expected.size} table(s), ${[...expected.values()].reduce((n, c) => n + c.size, 0)} colonne(s)).`,
);
