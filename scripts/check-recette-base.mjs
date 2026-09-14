#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-recette-base.mjs — « la recette a-t-elle le droit d'écrire ici ? »
//
//   npm run check:recette-base                  (lecture seule, exit 0 ou 1)
//   npm run check:recette-base -- --allow       (dérogation explicite, à la main)
//   npm run check:recette-base -- --url https://….supabase.co
//
// Pourquoi ce contrôle existe : les cycles E2E créent des élèves, parents,
// employés, paiements et dépenses de démonstration DANS LA BASE PARTAGÉE — celle
// que l'école utilise. C'est ce qui prouve le chemin réel, et c'est aussi ce qui
// a rempli le journal d'audit de 432 lignes de bruit de recette avant la mise en
// service. Le jour où l'école saisit son premier élève, ces lignes se mêleraient
// aux siennes : ce contrôle refuse l'écriture à ce moment-là, en nommant les
// comptes qu'il a lus, plutôt que de le confier à la mémoire de quelqu'un.
//
// Il ne modifie RIEN (lecture seule) et il ne juge jamais sans avoir compté.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSchoolCounts, recetteWriteVerdict, SCHOOL_TABLES } from './lib/recette-base.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const readEnvFile = (pathname) => {
  const out = {};
  if (!existsSync(pathname)) return out;
  for (const line of readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? '' : (args[i + 1] ?? '');
};
const env = { ...readEnvFile(join(root, '.env')), ...process.env };
const BASE = (flag('--url') || env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
const ALLOW = args.includes('--allow');

if (!BASE || !SERVICE) {
  console.error(
    '⚠️  secrets absents (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — ' +
      'la base n’a PAS été regardée, donc rien n’est autorisé ni refusé. Ce n’est pas un vert.',
  );
  process.exit(2);
}

// Un comptage qui échoue n'est PAS un zéro : sans chiffre, on ne juge pas.
const { counts, unread } = await readSchoolCounts({ base: BASE, key: SERVICE });

if (unread.length) {
  console.error(`❌ ${unread.length} table(s) non comptée(s) : ${unread.join(' · ')}`);
  console.error('   Sans chiffre, on n’autorise rien : relancez quand la base répond.');
  process.exit(2);
}

console.log(`🔎 recette — ${BASE}`);
console.log(
  `   comptées (lecture seule) : ${SCHOOL_TABLES.map((t) => `${t} ${counts[t]}`).join(' · ')}`,
);

const verdict = recetteWriteVerdict({ counts, allow: ALLOW });
if (verdict.ok) {
  console.log(`✅ ${verdict.cause} — ${verdict.detail}`);
  process.exit(0);
}

console.error(`❌ ${verdict.cause}`);
console.error(`   ${verdict.detail}`);
process.exit(1);
