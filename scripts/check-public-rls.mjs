#!/usr/bin/env node
/**
 * check-public-rls.mjs — une table de `public` est-elle lisible sans RLS ?
 *
 *   npm run check:public-rls            (lecture seule ; sort en 1 si une table est ouverte)
 *   npm run check:public-rls -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * Le 2026-10-11, la clé PUBLIQUE du site (celle qui est inlinée dans le bundle,
 * et que donc n'importe quel visiteur lit) rendait les 14 lignes de
 * `public.students_dupe_backup_20261005` : noms d'élèves, téléphones de parents,
 * notes médicales. La table était un artefact de dédoublonnage créé par
 * `create table … as select` — un `create table as` n'active pas RLS, et les
 * privilèges par défaut de Supabase ouvrent `select` à `anon`.
 *
 * Les gardes existantes (`scripts/verify-anon-rls.mjs`, veille `prod-anon-rls`)
 * sondent bien le refus anon, mais sur une LISTE DE TABLES DÉCLARÉES, extraite
 * des migrations : une table que personne n'a déclarée leur est invisible. C'est
 * la leçon du canal de mise à jour, payée une deuxième fois : *un mécanisme qui
 * vérifie ce qu'on lui nomme est muet sur ce qu'on ne lui nomme pas*.
 *
 * Cette commande-ci ÉNUMÈRE le catalogue `public` et refuse toute table où RLS
 * n'est pas activée — sans liste à maintenir, donc la suivante sera attrapée le
 * jour de sa création.
 *
 * ─── Ce qu'elle ne fait pas ─────────────────────────────────────────────────
 * Elle n'active JAMAIS RLS elle-même. Un contrôle qui corrige efface la preuve
 * de ce qu'il a trouvé, et la décision — activer le verrou, écrire les
 * politiques, ou supprimer la table d'artefact — appartient à un humain qui a vu
 * les lignes exposées. Elle n'écrit donc rien, nulle part.
 *
 * Elle ne juge pas les POLITIQUES non plus : `relrowsecurity` vrai ne dit pas
 * que la politique laisse passer les bonnes lignes. Ce refus-là est le métier de
 * `verify-anon-rls.mjs`, qui éprouve des lignes réelles. Voir
 * `scripts/lib/rls-coverage.mjs` pour ce qui est jugé, dit, ou déclaré non jugé.
 *
 * ─── Un vert se mesure ──────────────────────────────────────────────────────
 * Zéro relation lue n'est pas un état sain : c'est un regard qui n'a rien
 * atteint (mauvaise base, catalogue vide, requête cassée). Sans mot de passe ou
 * avec une énumération vide, la commande sort en 2 — « je n'ai pas pu regarder »
 * n'est pas un vert, c'est un refus.
 *
 * ─── Connexion ──────────────────────────────────────────────────────────────
 * Connexion DIRECTE à Postgres (pas de REST) : le catalogue ne se lit pas à
 * travers PostgREST, et une lecture qui dépendrait d'une politique pour vérifier
 * l'absence de politique serait circulaire. Le mot de passe vient de
 * SUPABASE_DB_PASSWORD (environnement, sinon `.env` lu à la main — le
 * `--env-file` de Node tronque au premier « # » non quoté et le vrai mot de passe
 * en contient un). `pg` n'est pas une dépendance déclarée du dépôt : s'il manque,
 * le message le dit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';

import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import { PUBLIC_RELATIONS_SQL, judgePublicRls } from './lib/rls-coverage.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const HELP = args.includes('--help') || args.includes('-h');

/**
 * Les tables qu'on accepte de ne PAS refuser, avec leur raison.
 *
 * Aucune aujourd'hui, et ce n'est pas un oubli : l'application parle à PostgREST
 * avec `anon`/`authenticated`, donc il n'existe pas de table de `public` qui ait
 * le droit de vivre sans RLS. Le jour où une exception serait réclamée (une
 * table d'outillage, par exemple), elle s'écrit ici avec sa raison — le module de
 * jugement refuse une exemption muette, une exemption qui nomme une table
 * absente, et une exemption qui ne correspond plus au réel (la table porte
 * désormais RLS), donc une exemption ne peut pas pourrir en silence.
 */
const EXEMPTIONS = [];

if (HELP) {
  console.log(`Énumérer les tables de public et refuser celles où RLS n'est pas activée.

  npm run check:public-rls [options]

  (aucune option)   énumérer, nommer les tables ouvertes, sortir en 1 s'il y en a
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Cette commande n'écrit RIEN : ni en base, ni ailleurs. Elle n'active jamais RLS
elle-même — un contrôle qui corrige efface la preuve de ce qu'il a trouvé.`);
  process.exit(0);
}

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

const env = parseEnvFile('.env');
const PASSWORD = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD;

const CANDIDATES = [
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${SHARED_PROJECT_REF}` },
  // Hôte direct : certaines machines n'atteignent pas le pooler (IPv6, réseau
  // d'école) — le second candidat évite un échec qui ne dirait rien du catalogue.
  { host: `db.${SHARED_PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres' },
];

async function connect() {
  const pg = await import('pg')
    .then((module) => module.default)
    .catch(() => null);
  if (!pg) throw new Error('Le module « pg » est absent. Installer l’outillage : npm i --no-save pg');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const candidate of CANDIDATES) {
      const client = new pg.Client({
        ...candidate,
        password: PASSWORD,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
        statement_timeout: 60000,
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

async function main() {
  if (!PASSWORD) {
    console.error(
      '❌ SUPABASE_DB_PASSWORD absent — sans lui, la commande n’a pas de catalogue à lire.\n' +
        '   Le renseigner dans .env ou dans l’environnement. « Je n’ai pas pu regarder » n’est pas un vert.',
    );
    process.exit(2);
  }

  const client = await connect();
  try {
    const relations = (await client.query(PUBLIC_RELATIONS_SQL)).rows;
    const report = judgePublicRls({ relations, exemptions: EXEMPTIONS });

    if (AS_JSON) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(`Couverture RLS de public — base partagée ${SHARED_PROJECT_REF}`);
      console.log(`Relations lues                    : ${report.scanned}`);
      console.log(`Tables jugées                     : ${report.judged}`);
      console.log(`Politiques comptées               : ${report.totalPolicies}`);
      console.log(`Tables avec RLS                   : ${report.guarded.length}`);
      console.log(`Tables SANS RLS                   : ${report.unguarded.length}`);
      for (const row of report.unguarded) {
        console.log(
          `   • ${row.name} (${row.label}, propriétaire ${row.owner || 'inconnu'}, ` +
            `${row.policies} politique(s)) — lisible par la clé PUBLIQUE du site`,
        );
      }
      for (const row of report.sealed) {
        console.log(`   · ${row.name} : RLS activée et AUCUNE politique — scellée (aucun rôle client ne lit), à savoir`);
      }
      for (const row of report.unjudged) {
        console.log(`   · ${row.name} : ${row.label} — NON jugée. ${row.reason}`);
      }
      for (const row of report.exempted) {
        console.log(`   · ${row.name} : exemptée — ${row.reason}`);
      }
      for (const problem of report.problems) {
        console.log(`   ⚠️  ${problem}`);
      }
      if (report.unguarded.length === 0 && report.problems.length === 0) {
        console.log('✅ Chaque table de public porte RLS — aucune n’est lisible sans verrou.');
      } else if (report.unguarded.length > 0) {
        console.log(
          `\n⚠️  ${report.unguarded.length} table(s) de public n’ont PAS RLS : la clé publique du site les lit.`,
        );
        console.log(
          '   Ce contrôle ne corrige rien : activer RLS, écrire les politiques, ou supprimer l’artefact ' +
            'est une décision qui se prend après avoir regardé les lignes exposées.',
        );
      }
    }

    // La substance, publiée par le contrôle lui-même : ce qu'il a LU (relations,
    // politiques) et ce qu'il a TROUVÉ. Un rapport qui ne dit pas sa couverture ne
    // prouve rien.
    if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
      publishEvidence({
        acted: true,
        count: report.scanned > 0 ? report.scanned : null,
        reason:
          `couverture RLS de public : ${report.scanned} relation(s) lue(s), ${report.judged} table(s) jugée(s), ` +
          `${report.totalPolicies} politique(s) comptée(s), ${report.unguarded.length} table(s) SANS RLS` +
          (report.unjudged.length > 0 ? `, ${report.unjudged.length} relation(s) non jugée(s) nommée(s)` : ''),
      });
    }

    // Zéro relation lue : le regard n'a rien atteint. C'est un refus (2), pas un
    // échec de conformité (1) — et surtout pas un vert.
    if (report.vacuous) {
      console.error(
        '❌ Aucune relation lue dans public — l’énumération n’a rien atteint.\n' +
          '   Un catalogue vide ne prouve pas qu’il n’y a rien à voir : « je n’ai pas pu regarder » n’est pas un vert.',
      );
      process.exitCode = 2;
      return;
    }
    if (report.unguarded.length > 0 || report.problems.length > 0) process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
