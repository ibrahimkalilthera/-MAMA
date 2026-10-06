#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/report-duplicate-receipts.mjs — relancer le contrôle de reçus en double
// à chaque fin de période de caisse, et en sortir un CSV pour l'école.
//
//   node scripts/report-duplicate-receipts.mjs
//   node scripts/report-duplicate-receipts.mjs --closing-week     (semaine close)
//   node scripts/report-duplicate-receipts.mjs --since 2026-10-01 --until 2026-10-31
//   node scripts/report-duplicate-receipts.mjs --out C:\Users\...\Bureau\recus-octobre.csv
//   node scripts/report-duplicate-receipts.mjs --out -            (CSV sur la sortie standard)
//
// Ce que le script NE fait pas, et c'est délibéré : il n'écrit RIEN en base. Il
// lit `public.payments`, il rend un fichier, il s'arrête. La décision — retirer
// une ligne — appartient à l'école, qui la prend depuis la fiche de l'élève (le
// bouton « supprimer un paiement »), et qui la laisse alors au journal d'audit.
// Un outil de contrôle qui corrige tout seul est un outil qui efface une preuve.
//
// Le contrôle existe déjà sous forme humaine (RAPPORT_RECUS_DOUBLONS.md,
// 2026-10-05) ; ce script le rend REJOUABLE : mêmes requêtes, sortie CSV, bornes
// de période. La logique (requêtes, colonnes, sérialisation) vit dans
// scripts/lib/duplicate-receipts.mjs et est prouvée par tests/duplicate-receipts.
//
// ─── Le déclencheur : la clôture de la période de caisse ────────────────────
// `--closing-week` borne le contrôle à la semaine ISO qui vient de se CLORE
// (lundi → dimanche, le découpage que src/lib/auditWeek.ts donne déjà au journal
// d'audit) et nomme le fichier d'après sa clé. C'est le mode du workflow
// hebdomadaire (.github/workflows/cash-period-receipts.yml) : chaque lundi, le
// contrôle tourne sans intervention et le CSV daté part en artefact du run.
// Lancé à la main sans cette option, le script garde tout l'historique (ou
// --since/--until) — un doublon non résolu ne doit pas disparaître d'une période
// à l'autre si on choisit de le suivre globalement.
//
// ─── Connexion ───────────────────────────────────────────────────────────────
// Connexion DIRECTE à Postgres (pas de REST) : le rapport doit voir les lignes
// telles qu'elles sont, sans dépendre d'une policy ni d'une clé d'API. Le mot de
// passe vient de SUPABASE_DB_PASSWORD (environnement, sinon `.env`). On lit
// `.env` à la main : le `--env-file` de Node tronque la valeur au premier « # »
// non quoté, et le vrai mot de passe en contient un (même raison que
// scripts/audit-user-profiles.mjs).
//
// `pg` n'est pas une dépendance déclarée du dépôt (mêmes scripts que
// audit-user-profiles.mjs et migrate-auth-users.mjs) : s'il manque, le message
// le dit au lieu d'un « Cannot find module » sec.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';

import {
  CRITERIA,
  DUPLICATE_GROUP_SQL,
  REUSED_RECEIPT_SQL,
  TOTAL_PAYMENTS_SQL,
  flaggedRows,
  summarizeReport,
  toCsv,
  closedWeekBounds,
} from './lib/duplicate-receipts.mjs';
import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const DEFAULT_OUT = 'rapport-recus-doublons.csv';

// ── Arguments ────────────────────────────────────────────────────────────────

/** Le corps d'une option `--nom valeur`, ou `undefined`. */
function optionValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`l'option ${name} attend une valeur`);
  }
  return value;
}

const HELP = process.argv.includes('--help') || process.argv.includes('-h');
const OUT_ARG = optionValue('--out');
const SINCE = optionValue('--since');
const UNTIL = optionValue('--until');
// `--closing-week` : borner à la semaine ISO qui vient de se clore.
const CLOSING_WEEK = process.argv.includes('--closing-week');

/** Une borne de date, ou `null`. Refuse tout ce qui n'est pas `AAAA-MM-JJ`. */
function dateBound(label, value) {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} doit être une date AAAA-MM-JJ (reçu : « ${value} »)`);
  }
  return value;
}

if (HELP) {
  console.log(`Contrôle des reçus en double — sortie CSV, lecture seule.

  node scripts/report-duplicate-receipts.mjs [options]

  --out <fichier>     fichier CSV à écrire (défaut : ${DEFAULT_OUT} ; « - » = sortie standard)
  --since <AAAA-MM-JJ>  ne regarder que les paiements à partir de cette date
  --until <AAAA-MM-JJ>  ne regarder que les paiements jusqu'à cette date
  --closing-week      borner à la semaine ISO qui vient de se clore (lundi → dimanche)
                      (fichier par défaut : rapport-recus-doublons-<AAAA-Sn>.csv)
  --help

Critères :
${CRITERIA.map((c) => `  • ${c}`).join('\n')}

Une ligne signalée est une ligne À VÉRIFIER, pas un doublon confirmé.`);
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

const env = parseEnvFile('.env');
const PASSWORD = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD;
if (!PASSWORD) {
  // Indécis, jamais un vert : sans mot de passe, le contrôle n'a rien pu lire.
  // Sous mandat d'automatisation, on le DÉCLARE (une inaction doit se voir) ;
  // sinon on se tait et on s'arrête avec la raison, sans bruit de preuve.
  const reason = 'SUPABASE_DB_PASSWORD absent — le contrôle des reçus en double n’a pas pu lire la base';
  if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
    publishEvidence({ acted: false, reason });
  }
  console.error(`❌ ${reason}. Le renseigner dans .env ou dans l’environnement (secret de dépôt en CI).`);
  process.exit(2);
}

// ── pg (dépendance d'outillage non déclarée) ─────────────────────────────────

let pg;
try {
  pg = (await import('pg')).default;
} catch {
  console.error('❌ Le module « pg » est absent. Installer l’outillage : npm i --no-save pg');
  process.exit(1);
}

// ── Connexion (pooler d'abord, puis hôte direct) ─────────────────────────────

const CANDIDATES = [
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${SHARED_PROJECT_REF}` },
  // Hôte direct : certaines machines n'atteignent pas le pooler (IPv6, réseau
  // d'école). Le second candidat évite un échec qui ne dirait rien du contrôle.
  { host: `db.${SHARED_PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres' },
];

async function connect() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
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

// ── Contrôle ─────────────────────────────────────────────────────────────────

async function main() {
  if (CLOSING_WEEK && (SINCE !== undefined || UNTIL !== undefined)) {
    throw new Error('--closing-week borne déjà la période : ne le combinez pas avec --since/--until');
  }
  const week = CLOSING_WEEK ? closedWeekBounds() : null;
  const since = week ? week.startIso : dateBound('--since', SINCE);
  const until = week ? week.endIso : dateBound('--until', UNTIL);
  if (since && until && since > until) {
    throw new Error(`--since (${since}) est après --until (${until})`);
  }

  const out = OUT_ARG ?? (week ? `rapport-recus-doublons-${week.key}.csv` : DEFAULT_OUT);
  const window = week
    ? `semaine ${week.key} (${week.startIso} → ${week.endIso})`
    : since || until
      ? `${since ?? '…'} → ${until ?? '…'}`
      : 'tout l’historique';
  console.log(`Contrôle des reçus en double — base partagée ${SHARED_PROJECT_REF} (lecture seule)`);
  console.log(`Période : ${window}\n`);

  const client = await connect();
  try {
    const params = [since, until];
    const duplicate = (await client.query(DUPLICATE_GROUP_SQL, params)).rows;
    const receipts = (await client.query(REUSED_RECEIPT_SQL, params)).rows;
    const total = Number((await client.query(TOTAL_PAYMENTS_SQL, params)).rows[0]?.n ?? 0);

    const rows = flaggedRows({ duplicateRows: duplicate, receiptRows: receipts });
    const summary = summarizeReport({ duplicateRows: duplicate, receiptRows: receipts, totalPayments: total });
    const csv = toCsv(rows);

    if (out === '-') {
      process.stdout.write(csv);
    } else {
      writeFileSync(out, csv, 'utf8');
    }

    console.log(`Paiements analysés            : ${summary.totalPayments}`);
    console.log(`Groupes même élève/date/montant : ${summary.duplicateGroups}`);
    console.log(`Numéros de reçu réutilisés     : ${summary.reusedReceipts}`);
    console.log(`Lignes signalées (CSV)         : ${summary.flaggedLines}`);
    console.log(
      summary.flaggedLines === 0
        ? '\n✅ Aucune ligne à vérifier.'
        : '\n⚠️  Ces lignes sont à VÉRIFIER, pas des doublons confirmés : deux versements du même montant le même jour sont possibles. Retirer une ligne fautive depuis la fiche de l’élève (bouton « supprimer un paiement »), ce qui l’écrit au journal d’audit.',
    );
    if (out !== '-') console.log(`\nFichier écrit : ${out}`);

    // La substance de cette automatisation, publiée par ELLE (sous le mandat de
    // l'étape qui l'exécute) : combien de paiements lus, combien de lignes à
    // vérifier. Un `--acted --count 0` est refusé — un zéro n'est pas un compte.
    if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
      publishEvidence({
        acted: true,
        count: summary.flaggedLines > 0 ? summary.flaggedLines : null,
        reason:
          `contrôle des reçus en double (${window}) : ${summary.totalPayments} paiement(s) ` +
          `analysé(s), ${summary.flaggedLines} ligne(s) à vérifier`,
      });
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
