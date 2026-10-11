#!/usr/bin/env node
/**
 * check-payment-ledger.mjs — le registre des paiements se referme-t-il ?
 *
 *   npm run check:payment-ledger                 (lecture seule ; sort en 1 si un écart existe)
 *   npm run check:payment-ledger -- --repair     (corrige les écarts, et l'écrit au journal)
 *   npm run check:payment-ledger -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * `students.amount_paid` duplique la somme de `payments.amount`, et c'est le
 * client qui réécrit la copie — en valeur absolue, depuis un instantané en
 * mémoire, sans lire l'erreur de l'écriture (src/lib/dataOps/payments.ts). Le
 * 2026-10-11, la mesure a trouvé un élève à 4 000 FCFA quand ses deux reçus en
 * valaient 8 000 : encaissés à 52 secondes d'intervalle, les deux gestes au
 * journal d'audit, le solde n'en comptant qu'un. Rien ne le voyait — ni l'écran,
 * ni la CI, ni le rapport hebdomadaire des doublons, qui ne regarde pas ce
 * registre-là.
 *
 * ─── Ce qui est comparé, et pourquoi par élève ──────────────────────────────
 * Pas deux totaux : une LISTE D'ÉLÈVES. Voir scripts/lib/payment-ledger.mjs —
 * le module porte le classement et la requête, et il se teste sans base.
 *
 * ─── Le défaut n'est PAS réparé ici ─────────────────────────────────────────
 * Ce script ne change pas le code qui écrit la copie : il révèle l'écart et
 * propose de le corriger une fois, sur les élèves nommés. La cause (une valeur
 * dérivée réécrite par le client) se répare en base — la faire calculer par
 * Postgres — et c'est un chantier qui a sa place ailleurs qu'ici.
 *
 * ─── --repair, et pourquoi ce n'est pas automatique ────────────────────────
 * Sans le drapeau, la commande n'écrit RIEN : elle mesure et elle sort en 1.
 * Avec lui, chaque élève divergent reçoit `amount_paid = somme de ses reçus`,
 * et une ligne d'audit (`REPAIR_AMOUNT_PAID`) part au journal avec les montants
 * avant/après RÉELLEMENT changés — la valeur rendue par l'`update`, jamais
 * l'intention. Un outil de contrôle qui corrige tout seul efface une preuve ;
 * un outil qui corrige quand on le lui demande, en laissant la trace, la garde.
 *
 * ─── Connexion ───────────────────────────────────────────────────────────────
 * Connexion DIRECTE à Postgres (pas de REST) : le registre se lit tel qu'il est,
 * sans dépendre d'une policy. Le mot de passe vient de SUPABASE_DB_PASSWORD
 * (environnement, sinon `.env`, lu à la main — le `--env-file` de Node tronque au
 * premier « # » non quoté et le vrai mot de passe en contient un). `pg` n'est pas
 * une dépendance déclarée du dépôt : s'il manque, le message le dit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';

import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import {
  GAP_LABELS,
  LEDGER_DIVERGENCE_SQL,
  LEDGER_REPAIR_AUDIT_SQL,
  LEDGER_REPAIR_SQL,
  LEDGER_TOTALS_SQL,
  summarizeLedger,
} from './lib/payment-ledger.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const args = process.argv.slice(2);
const REPAIR = args.includes('--repair');
const AS_JSON = args.includes('--json');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log(`Reconcilier students.amount_paid et la somme de payments.amount.

  npm run check:payment-ledger [options]

  (aucune option)   mesurer, nommer les écarts, sortir en 1 s'il y en a
  --repair          corriger les écarts mesurés (amount_paid = somme des reçus)
                    ET écrire une ligne d'audit par élève réparé
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Sans --repair, cette commande n'écrit rien : ni en base, ni ailleurs.`);
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
  // d'école) — le second candidat évite un échec qui ne dirait rien du registre.
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
      '❌ SUPABASE_DB_PASSWORD absent — sans lui, la commande n’a pas de registre à lire.\n' +
        '   Le renseigner dans .env ou dans l’environnement. « Je n’ai pas pu regarder » n’est pas un vert.',
    );
    process.exit(2);
  }

  const client = await connect();
  try {
    const totals = (await client.query(LEDGER_TOTALS_SQL)).rows[0] ?? {};
    const divergences = (await client.query(LEDGER_DIVERGENCE_SQL)).rows;
    const summary = summarizeLedger({ divergences, totals });

    if (AS_JSON) {
      process.stdout.write(`${JSON.stringify({ ...summary, repaired: [] }, null, 2)}\n`);
    } else {
      console.log(`Registre des paiements — base partagée ${SHARED_PROJECT_REF}`);
      console.log(`Élèves lus                        : ${summary.students}`);
      console.log(`Paiements lus                     : ${summary.payments}`);
      console.log(`Somme des amount_paid             : ${money(summary.rollupTotal)}`);
      console.log(`Somme des paiements               : ${money(summary.linesTotal)}`);
      console.log(`Écart global                      : ${money(summary.gap)}`);
      console.log(`Élèves dont les deux montants divergent : ${summary.diverging}`);
      for (const row of summary.rows) {
        console.log(
          `   • ${row.id} — amount_paid ${money(row.rollup)} / reçus ${money(row.lines)} ` +
            `(écart ${money(row.gap)}) : ${GAP_LABELS[row.kind]}`,
        );
      }
      if (summary.diverging === 0) {
        console.log('✅ Le registre se referme : chaque solde vaut la somme de ses reçus.');
      } else {
        const kinds = Object.entries(summary.byKind)
          .map(([kind, count]) => `${GAP_LABELS[kind]} — ${count}`)
          .join(' · ');
        console.log(
          `\n⚠️  ${summary.diverging} élève(s) portent un solde qui ne vaut pas la somme de ses reçus (${kinds}).`,
        );
        console.log(
          '   La somme des REÇUS fait foi : c’est elle qui est encaissée. Relancer avec --repair écrit ' +
            'amount_paid = somme des reçus pour ces élèves, et laisse une ligne au journal d’audit.',
        );
      }
    }

    let repaired = [];
    if (REPAIR && summary.diverging > 0) {
      const ids = summary.rows.map((row) => row.id);
      const before = new Map(summary.rows.map((row) => [row.id, row.rollup]));
      const changed = (await client.query(LEDGER_REPAIR_SQL, [ids])).rows;
      for (const row of changed) {
        const previous = before.get(row.student_id);
        const next = Number(row.amount_paid);
        await client.query(LEDGER_REPAIR_AUDIT_SQL, [
          row.student_id,
          `Réconciliation du registre : solde corrigé de ${previous} à ${next} FCFA ` +
            `(la somme des reçus de cet élève vaut ${next} FCFA) — contrôle check:payment-ledger --repair`,
          JSON.stringify({ before: previous, after: next, source: 'receipts', command: 'check:payment-ledger' }),
        ]);
        repaired.push({ id: row.student_id, before: previous, after: next });
        console.log(`🔧 ${row.student_id} — ${money(previous)} → ${money(next)} (journal d’audit écrit)`);
      }
      if (changed.length === 0) {
        console.log('   (aucune ligne écrite : l’état a changé entre la mesure et la correction — rien à faire)');
      }
    }
    if (REPAIR && summary.diverging === 0) {
      console.log('   --repair : rien à corriger, le registre se referme déjà.');
    }

    // La substance, publiée par le contrôle lui-même : ce qu'il a LU (élèves,
    // paiements) et ce qu'il a TROUVÉ. Un rapport qui ne dit pas sa couverture
    // ne prouve rien.
    if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
      publishEvidence({
        acted: true,
        count: summary.students > 0 ? summary.students : null,
        reason:
          `registre réconcilié : ${summary.students} élève(s) et ${summary.payments} paiement(s) lus, ` +
          `${summary.diverging} élève(s) dont le solde ne vaut pas la somme des reçus` +
          (REPAIR && repaired.length > 0 ? `, ${repaired.length} corrigé(s) et journalisé(s)` : ''),
      });
    }

    if (summary.diverging > 0 && !REPAIR) process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
