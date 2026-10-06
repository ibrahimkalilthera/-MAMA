#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/report-duplicates.mjs — relancer le contrôle des doublons en double
// (reçus et registre des élèves) et en sortir les CSV pour l'école.
//
//   node scripts/report-duplicates.mjs
//   node scripts/report-duplicates.mjs --closing-week     (semaine close)
//   node scripts/report-duplicates.mjs --since 2026-10-01 --until 2026-10-31
//   node scripts/report-duplicates.mjs --out C:\Users\...\Bureau\recus-octobre.csv
//   node scripts/report-duplicates.mjs --out-eleves C:\Users\...\Bureau\eleves.csv
//   node scripts/report-duplicates.mjs --out -            (CSV des reçus sur la sortie standard)
//
// ─── Deux familles, un seul passage ─────────────────────────────────────────
//   • les REÇUS (scripts/lib/duplicate-receipts.mjs) : un paiement saisi deux
//     fois, un numéro de reçu réutilisé. Borné à une période — une caisse se
//     clôt, et le contrôle hebdomadaire porte sur la semaine qui vient de
//     fermer (`--closing-week`).
//   • le REGISTRE (scripts/lib/duplicate-students.mjs) : une fiche d'élève en
//     double (même nom, même classe), avec les colonnes qui permettent de
//     trancher. Relu EN ENTIER, sans borne : un doublon d'inscription ne se
//     périme pas avec la semaine, et une liste de choses à trancher qui
//     s'effacerait toute seule serait pire qu'inutile.
//
// Les deux tiennent dans UNE commande parce que c'est le même geste — un
// contrôle de fin de période au bureau —, une seule connexion, et une seule
// preuve à publier. Deux commandes auraient obligé le workflow hebdomadaire à
// publier deux preuves pour un seul run, et l'audit ne lit qu'une déclaration
// par run : la seconde aurait été muette, ou pire, prise pour la première.
//
// ─── Ce que ce script NE fait pas, et c'est délibéré ────────────────────────
// Il n'écrit RIEN en base. Il lit, il rend des fichiers, il s'arrête. La décision
// — retirer un paiement, fusionner ou supprimer une fiche — appartient à l'école,
// depuis la fiche de l'élève, et laisse alors une trace au journal d'audit. Un
// outil de contrôle qui corrige tout seul est un outil qui efface une preuve.
//
// ─── Ce qu'une ligne signalée EST ───────────────────────────────────────────
// Une ligne À VÉRIFIER, pas un doublon confirmé. Deux versements du même montant
// le même jour sont possibles (fratrie, acompte puis solde) ; deux homonymes dans
// une même classe existent (423 élèves ont donné deux groupes le 2026-10-06). Le
// vocabulaire est choisi : « doublon confirmé » ferait supprimer des données
// réelles.
//
// ─── Le déclencheur : la clôture de la période de caisse ────────────────────
// `--closing-week` borne le contrôle des REÇUS à la semaine ISO qui vient de se
// CLORE (lundi → dimanche, le découpage que src/lib/auditWeek.ts donne déjà au
// journal d'audit). C'est le mode du workflow hebdomadaire
// (.github/workflows/cash-period-receipts.yml) : chaque lundi, le contrôle tourne
// sans intervention et les CSV datés partent en artefacts du run. Lancé à la main
// sans cette option, il garde tout l'historique des paiements (ou `--since`/
// `--until`) — un doublon non résolu ne doit pas disparaître d'une période à
// l'autre si on choisit de le suivre globalement. Le registre, lui, est toujours
// complet.
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
  closedWeekBounds,
  flaggedRows,
  summarizeReport,
  toCsv,
} from './lib/duplicate-receipts.mjs';
import {
  CRITERIA_STUDENTS,
  DUPLICATE_STUDENT_SQL,
  TOTAL_STUDENTS_SQL,
  flaggedStudentRows,
  summarizeStudents,
  STUDENT_CSV_COLUMNS,
} from './lib/duplicate-students.mjs';
import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const DEFAULT_OUT = 'rapport-recus-doublons.csv';
const DEFAULT_STUDENTS_OUT = 'rapport-eleves-doublons.csv';

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
const OUT_STUDENTS_ARG = optionValue('--out-eleves');
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
  console.log(`Contrôle des doublons — reçus et registre des élèves — sortie CSV, lecture seule.

  node scripts/report-duplicates.mjs [options]

  --out <fichier>       CSV des REÇUS à écrire (défaut : ${DEFAULT_OUT} ; « - » = sortie standard)
  --out-eleves <fichier> CSV du REGISTRE à écrire (défaut : ${DEFAULT_STUDENTS_OUT} ; « - » = sortie standard)
  --since <AAAA-MM-JJ>  ne regarder que les paiements à partir de cette date
  --until <AAAA-MM-JJ>  ne regarder que les paiements jusqu'à cette date
  --closing-week      borner les paiements à la semaine ISO qui vient de se clore
                      (lundi → dimanche ; fichier par défaut : rapport-recus-doublons-<AAAA-Sn>.csv)
  --help

Les bornes de période (--since, --until, --closing-week) ne concernent que les
PAIEMENTS : un doublon d'inscription ne se périme pas avec la semaine, donc le
registre des élèves est relu en entier à chaque passage.

Critères des reçus :
${CRITERIA.map((c) => `  • ${c}`).join('\n')}

Critères du registre :
${CRITERIA_STUDENTS.map((c) => `  • ${c}`).join('\n')}

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
  const reason = 'SUPABASE_DB_PASSWORD absent — le contrôle des doublons n’a pas pu lire la base';
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
  if (OUT_ARG === '-' && OUT_STUDENTS_ARG === '-') {
    // Deux CSV sur le même flux s'entrelaceraient : « - » sert à PIPE un fichier,
    // pas à en concaténer deux qui n'ont pas le même en-tête.
    throw new Error('--out - et --out-eleves - ne peuvent pas viser le même flux : écrivez au moins l’un des deux dans un fichier');
  }
  const week = CLOSING_WEEK ? closedWeekBounds() : null;
  const since = week ? week.startIso : dateBound('--since', SINCE);
  const until = week ? week.endIso : dateBound('--until', UNTIL);
  if (since && until && since > until) {
    throw new Error(`--since (${since}) est après --until (${until})`);
  }

  const out = OUT_ARG ?? (week ? `rapport-recus-doublons-${week.key}.csv` : DEFAULT_OUT);
  const studentsOut = OUT_STUDENTS_ARG ?? DEFAULT_STUDENTS_OUT;
  const window = week
    ? `semaine ${week.key} (${week.startIso} → ${week.endIso})`
    : since || until
      ? `${since ?? '…'} → ${until ?? '…'}`
      : 'tout l’historique';
  console.log(`Contrôle des doublons — base partagée ${SHARED_PROJECT_REF} (lecture seule)`);
  console.log(`Période des paiements : ${window}`);
  console.log('Registre des élèves : complet (un doublon d’inscription ne se périme pas)\n');

  const client = await connect();
  try {
    const params = [since, until];
    const duplicate = (await client.query(DUPLICATE_GROUP_SQL, params)).rows;
    const receipts = (await client.query(REUSED_RECEIPT_SQL, params)).rows;
    const total = Number((await client.query(TOTAL_PAYMENTS_SQL, params)).rows[0]?.n ?? 0);

    const rows = flaggedRows({ duplicateRows: duplicate, receiptRows: receipts });
    const summary = summarizeReport({ duplicateRows: duplicate, receiptRows: receipts, totalPayments: total });
    const csv = toCsv(rows);

    const studentDuplicate = (await client.query(DUPLICATE_STUDENT_SQL)).rows;
    const studentTotal = Number((await client.query(TOTAL_STUDENTS_SQL)).rows[0]?.n ?? 0);
    const studentRows = flaggedStudentRows({ studentRows: studentDuplicate });
    const studentSummary = summarizeStudents({ studentRows: studentDuplicate, totalStudents: studentTotal });
    const studentCsv = toCsv(studentRows, { columns: STUDENT_CSV_COLUMNS });

    if (out === '-') process.stdout.write(csv);
    else writeFileSync(out, csv, 'utf8');
    if (studentsOut === '-') process.stdout.write(studentCsv);
    else writeFileSync(studentsOut, studentCsv, 'utf8');

    console.log(`— Reçus (${window})`);
    console.log(`Paiements analysés              : ${summary.totalPayments}`);
    console.log(`Groupes même élève/date/montant : ${summary.duplicateGroups}`);
    console.log(`Numéros de reçu réutilisés      : ${summary.reusedReceipts}`);
    console.log(`Lignes signalées (CSV)          : ${summary.flaggedLines}`);
    if (summary.flaggedLines === 0) {
      console.log('✅ Aucun reçu à vérifier.');
    } else {
      console.log('⚠️  Ces lignes sont à VÉRIFIER, pas des doublons confirmés : deux versements du même montant le même jour sont possibles. Retirer une ligne fautive depuis la fiche de l’élève (bouton « supprimer un paiement »), ce qui l’écrit au journal d’audit.');
    }
    if (out !== '-') console.log(`   Fichier écrit : ${out}`);

    console.log(`\n— Registre des élèves (tout le registre)`);
    console.log(`Fiches analysées                : ${studentSummary.totalStudents}`);
    console.log(`Groupes même nom + même classe  : ${studentSummary.duplicateGroups}`);
    console.log(`Fiches signalées (CSV)          : ${studentSummary.flaggedLines}`);
    if (studentSummary.flaggedLines === 0) {
      console.log('✅ Aucune fiche à vérifier.');
    } else {
      console.log('⚠️  Ces fiches sont à VÉRIFIER, pas des doublons confirmés : deux homonymes dans une même classe existent. Les colonnes matricule, parent, téléphone et dates disent de quoi trancher — la décision appartient à l’école, depuis la fiche.');
    }
    if (studentsOut !== '-') console.log(`   Fichier écrit : ${studentsOut}`);

    // La substance de cette automatisation, publiée par ELLE (sous le mandat de
    // l'étape qui l'exécute) : combien de lignes lues, combien de lignes à
    // vérifier, dans les DEUX familles. Un `--acted --count 0` est refusé — un
    // zéro n'est pas un compte.
    const flagged = summary.flaggedLines + studentSummary.flaggedLines;
    if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
      publishEvidence({
        acted: true,
        count: flagged > 0 ? flagged : null,
        reason:
          `contrôle des doublons (${window}) : ${summary.totalPayments} paiement(s) et ` +
          `${studentSummary.totalStudents} fiche(s) analysé(s), ${summary.flaggedLines} ligne(s) de reçus ` +
          `et ${studentSummary.flaggedLines} fiche(s) à vérifier`,
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
