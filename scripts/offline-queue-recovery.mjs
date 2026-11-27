#!/usr/bin/env node
/**
 * offline-queue-recovery.mjs — RÉCUPÉRER une file hors-ligne, sans rien perdre.
 *
 *   node scripts/offline-queue-recovery.mjs --snippet
 *   node scripts/offline-queue-recovery.mjs file-hors-ligne.json
 *   node scripts/offline-queue-recovery.mjs file-hors-ligne.json --map rattachement.json
 *
 * ─── Ce que la commande fait ────────────────────────────────────────────────
 * 1. elle CLASSE chaque geste de la file par ce que la base en fera au prochain
 *    drainage (voir `auditOfflineQueue`, scripts/lib/offline-queue-audit.mjs) ;
 * 2. elle relit la base EN LECTURE SEULE (`select`, jamais d'écriture) pour
 *    savoir quels élèves et quels reçus existent — c'est ce qui distingue « déjà
 *    enregistré » de « rattaché à un élève qui n'existe pas » ;
 * 3. elle écrit un constat (`<dump>.rapport.json` + `<dump>.rapport.md`) ;
 * 4. avec `--map`, elle écrit une file CORRIGÉE (`<dump>.corrigee.json`) où les
 *    références d'élève pointent vers les fiches réelles, et où les `addStudent`
 *    devenus inutiles sont retirés — en le nommant, un par un.
 *
 * ─── Ce qu'elle ne fait PAS, et pourquoi ────────────────────────────────────
 * Aucune écriture en base, aucun geste supprimé dans la file d'origine. La file
 * corrigée est un NOUVEAU fichier, que l'école dépose elle-même dans le
 * `localStorage` du poste : c'est le rejeu de l'application qui écrit ensuite,
 * avec ses déclencheurs, son journal et son idempotence — exactement comme si
 * la file n'avait jamais été mal rattachée. Écrire les paiements directement en
 * base ferait passer des reçus sans leur journal, et compterait deux fois ce que
 * le drainage aurait aussi rejoué.
 *
 * ─── Sortie ─────────────────────────────────────────────────────────────────
 * 0 = constat établi, rien de bloqué ; 1 = constat établi, mais des gestes
 * restent bloqués ou à rattacher ; 2 = pas de constat possible (fichier ou base
 * illisible) — « je n'ai pas pu regarder » n'est jamais un vert.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { connectHostedDb, readDbPassword } from './lib/hosted-db.mjs';
import {
  QUEUE_STORAGE_KEY,
  VERDICT,
  auditOfflineQueue,
  isBlocking,
  normalizeQueue,
  reportToMarkdown,
  rewriteQueue,
} from './lib/offline-queue-audit.mjs';

const HELP = `offline-queue-recovery — récupérer une file hors-ligne sans rien perdre

  --snippet                 afficher le code à coller dans la console du poste
                            pour exporter la file (aucune suppression)
  <fichier.json>            constater ce que la base fera de chaque geste
  --map <fichier.json>      appliquer une correspondance { "<id local>": "<id élève>" }
                            et écrire la file corrigée
  --out <dossier>           où écrire les fichiers produits (défaut : à côté du dump)

Aucune écriture en base. Aucun geste supprimé de la file d'origine.`;

/** Le code à coller dans la console du poste (devtools ouverts sur l'application). */
const SNIPPET = `(() => {
  const raw = localStorage.getItem('${QUEUE_STORAGE_KEY}');
  if (!raw) { console.warn('File hors ligne vide : rien à exporter.'); return; }
  const blob = new Blob([raw], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'file-hors-ligne-' + new Date().toISOString().slice(0, 10) + '.json';
  link.click();
  URL.revokeObjectURL(link.href);
  console.log('Gestes exportés :', JSON.parse(raw).length);
})();`;

function fail(message, code = 2) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { dump: null, map: null, out: null, snippet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--snippet') options.snippet = true;
    else if (arg === '--map') options.map = argv[++i] ?? fail('--map attend un fichier');
    else if (arg === '--out') options.out = argv[++i] ?? fail('--out attend un dossier');
    else if (arg.startsWith('--')) fail(`option inconnue : ${arg}`);
    else if (!options.dump) options.dump = arg;
    else fail(`argument en trop : ${arg}`);
  }
  return options;
}

function readJson(path, what) {
  if (!existsSync(path)) fail(`${what} introuvable : ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(`${what} illisible (${path}) : ${error.message}`);
  }
}

/**
 * La correspondance décidée par l'école : un objet `{ "<id local>": "<id élève>" }`,
 * ou une liste `[{ de, vers }]` / `[{ from, to }]` — la forme que l'école préfère.
 */
function readMapping(path) {
  const raw = readJson(path, 'correspondance');
  if (Array.isArray(raw)) {
    const pairs = {};
    for (const row of raw) {
      const from = row?.de ?? row?.from ?? row?.localId;
      const to = row?.vers ?? row?.to ?? row?.studentId ?? row?.student_id;
      if (!from || !to) fail('chaque ligne de correspondance doit porter « de » et « vers »');
      pairs[String(from)] = String(to);
    }
    return pairs;
  }
  if (raw && typeof raw === 'object') return raw.map ?? raw.mapping ?? raw;
  return fail('la correspondance doit être un objet { "<id local>": "<id élève>" } ou une liste');
}

function countLine(label, count, total) {
  const share = total ? Math.round((count / total) * 100) : 0;
  return `  ${label.padEnd(22)} ${String(count).padStart(4)}  ${String(share).padStart(3)} %`;
}

const BLOCKING_LABELS = {
  [VERDICT.ELEVE_A_RATTACHER]: 'élève introuvable',
  [VERDICT.DOUBLON_METIER]: 'fiche déjà existante',
  [VERDICT.RECU_DEJA_PRIS]: 'reçu déjà porté ailleurs',
  [VERDICT.CIBLE_ABSENTE]: 'ligne visée absente',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.snippet) {
    console.log('# Console du poste (devtools de l’application), puis Entrée :\n');
    console.log(SNIPPET);
    return 0;
  }
  if (!options.dump) {
    console.log(HELP);
    return 2;
  }

  const dumpPath = resolve(options.dump);
  const queue = normalizeQueue(readJson(dumpPath, 'file hors-ligne'));
  const outDir = options.out ? resolve(options.out) : dirname(dumpPath);
  const stem = basename(dumpPath, extname(dumpPath));

  const password = readDbPassword(process.cwd());
  if (!password) fail('SUPABASE_DB_PASSWORD absent (.env ou environnement) : sans lui, aucun constat possible.');
  const db = await connectHostedDb({ password });
  let students;
  let payments;
  try {
    students = (await db.query(
      'select id::text as id, name, parent_phone, grade, academic_year from public.students',
    )).rows;
    payments = (await db.query(
      `select id::text as id, student_id::text as student_id, receipt_number,
              amount::text as amount, to_char(date, 'YYYY-MM-DD') as date
         from public.payments`,
    )).rows;
  } finally {
    await db.end();
  }

  const report = auditOfflineQueue({ items: queue, students, payments });

  console.log(`\nFile hors-ligne — ${queue.length} geste(s) · base : ${students.length} élève(s), ${payments.length} paiement(s)\n`);
  for (const [verdict, count] of Object.entries(report.byVerdict)) {
    console.log(countLine(verdict, count, report.total));
  }
  console.log('');

  if (report.toAttach.length) {
    console.log('À RATTACHER — reçus à reconnaître (le geste ne dit qu’un identifiant) :');
    for (const entry of report.toAttach) {
      const bits = [
        entry.receiptNumber ? `reçu n° ${entry.receiptNumber}` : 'reçu sans numéro',
        entry.amount != null ? `${entry.amount} F` : 'montant inconnu',
        entry.date ?? 'date inconnue',
        `cible ${entry.studentRef}`,
      ];
      console.log(`  · geste n° ${entry.index} — ${bits.join(' · ')}`);
    }
    console.log('');
  }

  const otherBlocking = report.blocking.filter((entry) => entry.verdict !== VERDICT.ELEVE_A_RATTACHER);
  if (otherBlocking.length) {
    console.log('AUTRES BLOCAGES :');
    for (const entry of otherBlocking) {
      console.log(`  · geste n° ${entry.index} (${entry.type}) — ${BLOCKING_LABELS[entry.verdict] ?? entry.verdict}`);
      console.log(`    ${entry.detail}`);
    }
    console.log('');
  }

  const propositions = Object.entries(report.mapping);
  if (propositions.length) {
    console.log('CORRESPONDANCES PROPOSÉES (vérifier avant d’appliquer) :');
    for (const [from, to] of propositions) console.log(`  · ${from}  →  ${to}`);
    console.log('');
  }

  const reportJsonPath = join(outDir, `${stem}.rapport.json`);
  const reportMdPath = join(outDir, `${stem}.rapport.md`);
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMdPath, reportToMarkdown(report, { dumpName: basename(dumpPath) }));
  console.log(`Constat écrit : ${reportJsonPath}`);
  console.log(`               ${reportMdPath}`);

  if (report.blocking.length === 0) {
    console.log('\n✅ Rien n’est bloqué : laissez le poste se synchroniser, ne videz pas la file.');
  } else {
    console.log(`\n⚠️  ${report.blocking.length} geste(s) ne partiront pas tels quels — aucun n’a été supprimé.`);
    console.log('   Répondez avec une correspondance (voir docs/RECUPERATION-FILE-HORS-LIGNE.md), puis :');
    console.log(`   node scripts/offline-queue-recovery.mjs ${basename(dumpPath)} --map rattachement.json`);
  }

  if (options.map) {
    const mapping = readMapping(resolve(options.map));
    const studentIds = new Set(students.map((s) => s.id));
    for (const [from, to] of Object.entries(mapping)) {
      if (!studentIds.has(to)) fail(`la correspondance ${from} → ${to} vise un élève absent de la base : refusé`);
    }
    const { items, rewritten, removed } = rewriteQueue(queue, mapping);
    const correctedPath = join(outDir, `${stem}.corrigee.json`);
    writeFileSync(correctedPath, `${JSON.stringify(items, null, 2)}\n`);

    console.log(`\nFile corrigée écrite : ${correctedPath}`);
    console.log(`  · ${rewritten.length} référence(s) d’élève réécrite(s)`);
    for (const row of rewritten) console.log(`      ${row.type} — ${row.field} : ${row.from} → ${row.to}`);
    if (removed.length) {
      console.log(`  · ${removed.length} geste(s) retiré(s) parce que l’élève existe déjà :`);
      for (const row of removed) console.log(`      ${row.type} (${row.id ?? 'sans id'}) — ${row.reason}`);
    }
    console.log('\nDéposer la file corrigée sur le poste (console de l’application) :');
    console.log(`  copy(await (await fetch('${basename(correctedPath)}')).text())  // ou coller le contenu du fichier`);
    console.log(`  localStorage.setItem('${QUEUE_STORAGE_KEY}', <contenu de ${basename(correctedPath)}>)`);
    console.log('  (garder l’original : c’est la preuve de ce qui attendait)');
    console.log('  puis « Synchroniser maintenant », et vérifier le nombre de gestes restants.');
  }

  return report.blocking.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => fail(error?.message ?? String(error)),
);
