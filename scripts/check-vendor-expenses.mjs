#!/usr/bin/env node
/**
 * check-vendor-expenses.mjs — le statut d'une dépense fournisseur tient-il sa
 * promesse de montant payé ?
 *
 *   npm run check:vendor-expenses           (lecture seule ; sort en 1 si un écart existe)
 *   npm run check:vendor-expenses -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * `vendor_expenses.payment_status` et `vendor_expenses.amount_paid` sont deux
 * copies du même fait, lues ENSEMBLE par quatre calculs d'argent
 * (`useDashboard`, `ExpensesView`, `useYearOps`, `pdfExpensesReport`). Jusqu'au
 * 2026-11-08, rien en base ne les empêchait de se contredire : un `paid` à 0, un
 * `unpaid` qui porte un montant, un `partial` à 150 % du dû. Le total des
 * dépenses de l'école est alors faux, et aucun contrôle ne le voyait —
 * contrairement au registre des reçus, qui a son `check:payment-ledger` et sa
 * veille quotidienne.
 *
 * ─── Le déclencheur ne dispense pas de mesurer ──────────────────────────────
 * `20261108000000_vendor_expense_paid_consistency.sql` normalise toute écriture
 * FUTURE et a rattrapé l'histoire. Il ne garantit rien de ce qui viendrait
 * après lui : un `DISABLE TRIGGER` (restauration de sauvegarde, intervention en
 * base), une migration qui le remplace, un `COPY` fait avec le déclencheur
 * absent. Ce contrôle mesure donc la RÈGLE sur les lignes réelles, chaque jour —
 * c'est la même division du travail que pour les reçus : le calcul est
 * autoritaire, la veille vérifie qu'il ne se contourne pas.
 *
 * ─── Aucune réparation automatique, et c'est un choix ──────────────────────
 * Le déclencheur neutralise déjà les écritures : une ligne divergente ne peut
 * venir que d'un contournement, donc la « corriger » sans regarder effacerait la
 * trace de ce contournement. Et un `partial` hors bornes demande un ARBITRAGE
 * (est-ce un payé complet ? un partiel mal saisi ?) que ce script ne peut pas
 * prendre à la place de l'école. Il mesure, il nomme, il sort en 1.
 *
 * ─── Connexion ──────────────────────────────────────────────────────────────
 * Connexion DIRECTE à Postgres (pas de REST) : le registre des dépenses se lit
 * tel qu'il est, sans dépendre d'une policy. `pg` n'est pas une dépendance
 * déclarée du dépôt : s'il manque, le message le dit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';

import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';
import {
  VENDOR_EXPENSE_DIVERGENCE_SQL,
  VENDOR_EXPENSE_TOTALS_SQL,
  VENDOR_GAP_LABELS,
  summarizeVendorExpenses,
} from './lib/vendor-expense-ledger.mjs';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log(`Comparer payment_status et amount_paid des dépenses fournisseurs.

  npm run check:vendor-expenses [options]

  (aucune option)   mesurer, nommer les écarts, sortir en 1 s'il y en a
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Cette commande n'écrit RIEN : ni en base, ni ailleurs. La règle statut/montant
est tenue par le déclencheur vendor_expense_paid_consistency ; ce contrôle
mesure qu'elle ne se contourne pas.`);
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
  // d'école) — le second candidat évite un échec qui ne dirait rien des dépenses.
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

const money = (value) => `${Number(value).toLocaleString('fr-FR')} FCFA`;

async function main() {
  if (!PASSWORD) {
    console.error(
      '❌ SUPABASE_DB_PASSWORD absent — sans lui, la commande n’a pas de dépenses à lire.\n' +
        '   Le renseigner dans .env ou dans l’environnement. « Je n’ai pas pu regarder » n’est pas un vert.',
    );
    process.exit(2);
  }

  const client = await connect();
  try {
    const totals = (await client.query(VENDOR_EXPENSE_TOTALS_SQL)).rows[0] ?? {};
    const divergences = (await client.query(VENDOR_EXPENSE_DIVERGENCE_SQL)).rows;
    const summary = summarizeVendorExpenses({ divergences, totals });

    if (AS_JSON) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.log(`Dépenses fournisseurs — base partagée ${SHARED_PROJECT_REF}`);
      console.log(`Dépenses lues                     : ${summary.expenses}`);
      console.log(`   payées / partielles / impayées : ${summary.paid} / ${summary.partial} / ${summary.unpaid}`);
      console.log(`Total dû                          : ${money(summary.owedTotal)}`);
      console.log(`Somme des amount_paid stockés     : ${money(summary.paidTotal)}`);
      console.log(`Total que l’application compte    : ${money(summary.countedTotal)}`);
      console.log(`Dépenses dont statut et montant divergent : ${summary.diverging}`);
      for (const row of summary.rows) {
        const who = row.vendor ? `${row.id} (${row.vendor})` : row.id;
        console.log(
          `   • ${who} — statut ${row.status ?? 'aucun'}, dû ${money(row.due)}, ` +
            `payé ${money(row.paid)}, compté ${money(row.counted)}` +
            (row.gap === 0 ? '' : ` (écart ${money(row.gap)})`) +
            ` : ${VENDOR_GAP_LABELS[row.kind]}`,
        );
      }
      if (summary.diverging === 0) {
        console.log('✅ La règle tient : chaque montant payé tient la promesse de son statut.');
      } else {
        const kinds = Object.entries(summary.byKind)
          .map(([kind, count]) => `${VENDOR_GAP_LABELS[kind]} — ${count}`)
          .join(' · ');
        console.log(
          `\n⚠️  ${summary.diverging} dépense(s) portent un montant payé qui contredit leur statut (${kinds}).`,
        );
        console.log(
          '   Le déclencheur normalise les écritures FUTURES : une ligne divergente vient d’un contournement ' +
            '(déclencheur désactivé, restauration, migration). Regardez la ligne avant de la corriger — ' +
            'un `partial` hors bornes demande un arbitrage, pas une réécriture.',
        );
      }
    }

    // La substance, publiée par le contrôle lui-même : ce qu'il a LU (dépenses)
    // et ce qu'il a TROUVÉ (dépenses dont le montant ne tient pas le statut).
    if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
      publishEvidence({
        acted: true,
        count: summary.expenses > 0 ? summary.expenses : null,
        reason:
          `règle statut/montant mesurée : ${summary.expenses} dépense(s) lue(s), ` +
          `${summary.diverging} dont le montant payé ne tient pas le statut`,
      });
    }

    if (summary.diverging > 0) process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
