#!/usr/bin/env node
/**
 * apply-migration.mjs — appliquer une migration à la base partagée, en prouvant
 * qu'elle n'y était pas AVANT et qu'elle y est APRÈS.
 *
 *   npm run db:apply -- supabase/migrations/20261011000000_payments_months.sql
 *   npm run db:apply -- supabase/migrations/a.sql supabase/migrations/b.sql
 *   npm run db:apply -- supabase/migrations/x.sql --dry-run     (aucune écriture)
 *   npm run db:apply -- supabase/migrations/x.sql --again       (fichier rejouable)
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * Les migrations de ce dépôt étaient appliquées À LA MAIN — CLI ou Dashboard
 * Supabase — et le prix a été payé deux fois. Le 2026-09-14, la colonne
 * `staff.category` a été écrite dans le code AVANT d'exister en base : tout ajout
 * d'employé était refusé, et le déploiement partait vert. Le 2026-10-11,
 * `payments.months` déclarait le même écart, et c'est le gate
 * `check:hosted-schema` qui a bloqué la publication — un gate qui a raison ne
 * remplace pas un geste qui a une commande.
 *
 * ─── Ce que la commande fait, dans cet ordre, et rien d'autre ───────────────
 *   1. elle REFUSE ce qu'elle ne peut pas prouver (chemin hors du dossier des
 *      migrations, ordre non chronologique, fichier qui ne déclare aucun objet
 *      observable, instruction que PostgreSQL refuse dans une transaction) ;
 *   2. elle vérifie AVANT : les objets déclarés par le fichier doivent être
 *      ABSENTS de la base — sinon le fichier est déjà appliqué et le rejouer ne
 *      prouverait rien (`--again` pour un fichier écrit pour être rejoué) ;
 *   3. elle applique le fichier TEL QUEL, dans une transaction, et la
 *      vérification « après » a lieu DANS cette transaction : si un seul objet
 *      déclaré manque, le `ROLLBACK` remet la base exactement comme avant ;
 *   4. elle relit le canal de l'APPLICATION (PostgREST, clé anon) pour dire si le
 *      poste voit la colonne — le seul verdict qui compte pour le bureau.
 *
 * Un fichier qui porte sa PROPRE transaction n'est pas ré-enveloppé (un `BEGIN`
 * de PL/pgSQL n'est pas une transaction : les corps `$$ … $$` sont écartés avant
 * de compter) — la vérification « après » a alors lieu après son `COMMIT`, et la
 * commande le DIT, parce qu'un `ROLLBACK` n'y est plus possible.
 *
 * ─── Ce qu'elle ne fait PAS ────────────────────────────────────────────────
 * Aucun registre « migrations appliquées » : les 33 migrations déjà en base n'y
 * seraient pas, et un état inventé se croit ensuite. La preuve d'application est
 * le SCHÉMA, lu dans les catalogues PostgreSQL — pas une table de plus.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIGRATIONS_DIR,
  applyVerdict,
  declaredObjects,
  migrationPathProblem,
  objectKeys,
  orderProblem,
  topLevelStatements,
  transactionBlockers,
  transactionControl,
} from './lib/apply-migration.mjs';
import { SHARED_PROJECT_REF, SHARED_PROJECT_URL, projectRefOf } from './lib/shared-project.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const HELP = args.includes('--help') || args.includes('-h');
const DRY_RUN = args.includes('--dry-run');
const AGAIN = args.includes('--again');
const TIMEOUT_S = Number(
  args.find((a) => a.startsWith('--timeout='))?.slice('--timeout='.length) ?? 300,
);
const files = args.filter((a) => !a.startsWith('--'));

if (HELP) {
  console.log(`Appliquer une migration à la base partagée, avec vérification avant et après.

  npm run db:apply -- <fichier.sql> [<fichier.sql> …] [options]

  --dry-run          vérifier ce qui se passerait (connexion et « avant » compris), sans écrire
  --again            ne pas refuser un fichier déjà appliqué (fichier écrit pour être rejoué)
  --timeout=<sec>    délai d'une instruction côté base (défaut 300 s)
  --help

Les fichiers vivent dans ${MIGRATIONS_DIR}/ et s'appliquent dans l'ordre de leur nom.
La migration est jouée TELLE QUELLE, dans une transaction : si un objet déclaré
manque après coup, tout est annulé.`);
  process.exit(0);
}

// ── Environnement ────────────────────────────────────────────────────────────
/** Lit un `.env` à la main (le mot de passe peut contenir « # »). */
function parseEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = { ...parseEnvFile(join(root, '.env')) };
const PASSWORD = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD;

// ── Ce qui est demandé ───────────────────────────────────────────────────────
if (files.length === 0) {
  console.error('❌ aucune migration demandée.\n   npm run db:apply -- supabase/migrations/<fichier>.sql');
  process.exit(2);
}

const paths = [];
const plans = [];
for (const file of files) {
  const problem = migrationPathProblem({ file, root, exists: existsSync });
  if (problem) {
    console.error(`❌ ${problem}`);
    process.exit(2);
  }
  const absolute = file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file) ? file : join(root, file);
  const name = absolute.split(/[\\/]+/).join('/').split(`${MIGRATIONS_DIR}/`)[1];
  if (paths.includes(name)) {
    console.error(`❌ « ${name} » est demandé deux fois.`);
    process.exit(2);
  }
  paths.push(name);
  plans.push({ name, absolute, sql: readFileSync(absolute, 'utf8') });
}

const order = orderProblem(paths);
if (order) {
  console.error(`❌ ${order}`);
  process.exit(2);
}

// ── Ce que chaque fichier engage ─────────────────────────────────────────────
for (const plan of plans) {
  plan.objects = declaredObjects(plan.sql);
  plan.statements = topLevelStatements(plan.sql);
  plan.control = transactionControl(plan.statements);
  plan.blockers = transactionBlockers(plan.statements);
  plan.keys = objectKeys(plan.objects);
}

const blockers = plans.flatMap((plan) => plan.blockers.map((b) => ({ ...b, file: plan.name })));
if (blockers.length > 0) {
  console.error('❌ ce fichier contient une instruction que PostgreSQL REFUSE dans une transaction :');
  for (const blocker of blockers) {
    console.error(`   • ${blocker.file} — ${blocker.command} : « ${blocker.statement}… »`);
  }
  console.error(
    '\n   La jouer enveloppée laisserait une base à moitié changée. Appliquez-la à la main, seule,\n' +
      '   puis relancez `npm run check:hosted-schema` : la commande refuse plutôt que de mentir sur son atomicité.',
  );
  process.exit(1);
}

const empty = plans.filter((plan) => plan.keys.length === 0);
if (empty.length > 0) {
  console.error('❌ un fichier qui ne déclare aucun objet observable ne peut pas être prouvé appliqué :');
  for (const plan of empty) console.error(`   • ${plan.name} — aucune table, colonne, contrainte, fonction, politique ou déclencheur`);
  process.exit(2);
}

if (!PASSWORD) {
  console.error(
    '❌ SUPABASE_DB_PASSWORD absent — sans lui, la commande n’a pas de base à interroger.\n' +
      '   Le renseigner dans .env ou dans l’environnement.',
  );
  process.exit(2);
}

// ── La cible : la base partagée, et rien d'autre ─────────────────────────────
// Ce script ÉCRIT. Il n'a donc pas d'option pour viser un autre projet : la
// connexion est construite sur le ref partagé, et le canal de l'application est
// refusé s'il pointe ailleurs (`.env.staging` nomme un autre projet — y écrire
// une migration de l'école serait le pire des deux mondes).
const appUrl = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || SHARED_PROJECT_URL).replace(/\/+$/, '');
if (projectRefOf(appUrl) !== SHARED_PROJECT_REF) {
  console.error(
    `❌ le canal de l’application ne pointe PAS la base partagée (${projectRefOf(appUrl) ?? appUrl}).\n` +
      `   Cette commande écrit : elle n’agit que sur ${SHARED_PROJECT_REF}.`,
  );
  process.exit(2);
}
const anonKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

// ── pg (dépendance d'outillage non déclarée) ─────────────────────────────────
let pg;
try {
  pg = (await import('pg')).default;
} catch {
  console.error('❌ Le module « pg » est absent. Installer l’outillage : npm i --no-save pg');
  process.exit(1);
}

const CANDIDATES = [
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${SHARED_PROJECT_REF}` },
  // Hôte direct : certaines machines n'atteignent pas le pooler (IPv6, réseau
  // d'école) — le second candidat évite un échec qui ne dirait rien du geste.
  { host: `db.${SHARED_PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres' },
];

async function connect() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const candidate of CANDIDATES) {
      const client = new pg.Client({
        ...candidate,
        password: PASSWORD,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
        statement_timeout: TIMEOUT_S * 1000,
      });
      try {
        await client.connect();
        return client;
      } catch (error) {
        lastError = error;
        await client.end().catch(() => undefined);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw lastError;
}

// ── La sonde : les catalogues de PostgreSQL, DANS la transaction ─────────────
/**
 * Les objets déclarés qui sont PRÉSENTS, lus dans les catalogues.
 *
 * Pas PostgREST : sa réponse passe par un cache de schéma qui ne voit qu'un
 * `COMMIT`, donc une vérification « après » faite là-bas serait un échec
 * systématique — ou, pire selon le sens, un vert qui ne prouve rien de la
 * transaction en cours.
 */
async function probeObjects(client, objects) {
  const present = new Set();
  const tables = objects.tables.map((table) => table.name);
  if (tables.length > 0) {
    const { rows } = await client.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [tables],
    );
    const have = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const table of objects.tables) {
      for (const column of table.columns) {
        if (have.has(`${table.name}.${column}`)) present.add(`column:${table.name}.${column}`);
      }
    }
  }
  const families = [
    ['constraint', 'select conname as name from pg_constraint where conname = any($1::text[])', objects.constraints],
    ['function', 'select proname as name from pg_proc where proname = any($1::text[])', objects.functions],
    ['policy', 'select policyname as name from pg_policies where policyname = any($1::text[])', objects.policies],
    ['trigger', 'select tgname as name from pg_trigger where tgname = any($1::text[]) and not tgisinternal', objects.triggers],
  ];
  for (const [kind, query, names] of families) {
    if (!names.length) continue;
    const { rows } = await client.query(query, [names]);
    for (const row of rows) present.add(`${kind}:${row.name}`);
  }
  return present;
}

/**
 * Le canal de l'APPLICATION voit-il la colonne ? C'est LÀ que l'incident du
 * 2026-09-14 s'est produit (PostgREST valide les colonnes avant la RLS, et
 * refuse un `select` sur une colonne qu'il ne connaît pas), et le cache de schéma
 * se recharge après coup : la relecture est donc réessayée, et un retard se DIT
 * au lieu de faire échouer une migration déjà prouvée appliquée.
 */
async function appChannelConfirmation(objects) {
  if (!anonKey) return { checked: false, reason: 'VITE_SUPABASE_ANON_KEY absente — le poste n’a pas été relu' };
  const tables = objects.tables;
  if (tables.length === 0) return { checked: false, reason: 'le fichier ne déclare aucune table : rien à relire côté poste' };
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let ok = true;
    for (const table of tables) {
      const columns = table.columns.length > 0 ? table.columns : ['*'];
      const url = `${appUrl}/rest/v1/${encodeURIComponent(table.name)}?select=${columns.map(encodeURIComponent).join(',')}&limit=0`;
      try {
        const response = await fetch(url, {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          ok = false;
          const body = await response.json().catch(() => null);
          last = `${table.name} → HTTP ${response.status}${body?.message ? ` « ${body.message} »` : ''}`;
          break;
        }
      } catch (error) {
        ok = false;
        last = `${table.name} → ${String(error?.message ?? error)}`;
        break;
      }
    }
    if (ok) return { checked: true, attempts: attempt };
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return { checked: false, reason: `le canal de l’application ne voit pas encore le schéma appliqué (${last})` };
}

// ── Le geste ─────────────────────────────────────────────────────────────────
console.log(`db:apply — base PARTAGÉE ${SHARED_PROJECT_REF} (écriture)${DRY_RUN ? ' — mode --dry-run, aucune écriture' : ''}`);
for (const plan of plans) {
  console.log(
    `   ${plan.name} · ${plan.keys.length} objet(s) déclaré(s) · ` +
      `${plan.control.length > 0 ? `transaction PROPRE au fichier (${plan.control.join(', ')})` : 'enveloppé dans une transaction par la commande'}`,
  );
  for (const key of plan.keys) console.log(`      • ${key}`);
}

const client = await connect();
let exitCode = 0;
try {
  for (const plan of plans) {
    const before = await probeObjects(client, plan.objects);
    // Le MÊME verdict sert deux fois : ici avec `after = before`, pour poser la
    // seule question « était-ce déjà là ? » (ce qui n'est PAS là est justement ce
    // que la migration doit apporter).
    const pre = applyVerdict({ objects: plan.objects, before, after: before, again: AGAIN });
    if (!pre.ok && pre.already.length > 0) {
      console.error(`\n❌ ${plan.name} : rien n’a été écrit.`);
      for (const problem of pre.problems) console.error(`   • ${problem}`);
      exitCode = 1;
      break;
    }
    const absent = plan.keys.length - before.size;
    console.log(`\n✅ ${plan.name} — « avant » vérifié : ${absent} objet(s) absent(s) sur ${plan.keys.length}, aucun déjà en base`);

    if (DRY_RUN) {
      console.log('   --dry-run : le fichier n’a pas été joué.');
      continue;
    }

    const managed = plan.control.length === 0;
    if (managed) await client.query('BEGIN');
    try {
      await client.query(plan.sql);
      const after = await probeObjects(client, plan.objects);
      const post = applyVerdict({ objects: plan.objects, before, after, again: AGAIN });
      if (!post.ok) {
        if (managed) {
          await client.query('ROLLBACK');
          console.error(`\n❌ ${plan.name} : ANNULÉ — la base est exactement comme avant.`);
        } else {
          console.error(`\n❌ ${plan.name} : appliqué, mais NON vérifié — le fichier porte sa propre transaction, donc l’annulation n’est plus possible.`);
        }
        for (const problem of post.problems) console.error(`   • ${problem}`);
        exitCode = 1;
        break;
      }
      if (managed) await client.query('COMMIT');
      console.log(
        `✅ ${plan.name} — « après » vérifié dans la transaction : ${post.keys.length} objet(s) déclaré(s), tous présents` +
          (managed ? ' — COMMIT' : ' — le fichier avait déjà validé sa transaction'),
      );
      for (const warning of post.warnings) console.log(`   ⚠️  ${warning}`);
    } catch (error) {
      if (managed) await client.query('ROLLBACK').catch(() => undefined);
      console.error(`\n❌ ${plan.name} : la base a REFUSÉ la migration — ${error.message}${error.code ? ` (SQLSTATE ${error.code})` : ''}`);
      console.error(managed ? '   Transaction annulée : rien n’a été écrit.' : '   Le fichier portait sa propre transaction : vérifiez l’état de la base avant de retenter.');
      exitCode = 1;
      break;
    }
  }

  if (exitCode === 0 && !DRY_RUN) {
    for (const plan of plans) {
      const confirmation = await appChannelConfirmation(plan.objects);
      if (confirmation.checked) {
        console.log(
          `🔎 ${plan.name} — le canal de l’application voit le schéma (PostgREST, clé anon)` +
            (confirmation.attempts > 1 ? ` après ${confirmation.attempts} lectures (cache de schéma)` : '') +
            ' : le poste lira la nouvelle colonne.',
        );
      } else {
        console.log(`   ⚠️  ${plan.name} — ${confirmation.reason}`);
        console.log('      La migration EST appliquée (catalogues PostgreSQL) — mais c’est ce canal que le bureau utilise : relancez `npm run check:hosted-schema`.');
      }
    }
    console.log('\n✅ terminé — relancez `npm run check:hosted-schema` pour le verdict complet des 33 migrations.');
  }
} finally {
  await client.end().catch(() => undefined);
}

process.exit(exitCode);
