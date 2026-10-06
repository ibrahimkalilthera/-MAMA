// Vérifier que toutes les références t.<key> dans les composants existent dans le dictionnaire (en + fr)
import fs from 'fs';
import path from 'path';

// The dictionaries live in src/i18n/domains/*.ts (en/fr blocks merged by the
// src/i18n/translations.ts barrel) — parse the domain files directly, since
// the barrel only re-exports spreads and carries no key/value pairs itself.
const DOMAINS_DIR = process.env.L10N_DOMAINS_DIR || 'src/i18n/domains';

// Le scan des usages `t.<clé>` lit les composants du DÉPÔT : il ne s'applique
// pas quand le contrôle est pointé sur une racine d'essai (une suite de tests
// fournit un mini-dictionnaire qui ne peut pas couvrir ces usages). La parité et
// les contrôles d'ordre/doublons, eux, restent actifs sur n'importe quelle racine.
const scanningRealTree = path.resolve(DOMAINS_DIR) === path.resolve('src/i18n/domains');

// Plusieurs clés peuvent être groupées sur une même ligne (ex: mon: "Lun", tue: "Mar", ...),
// donc on capture TOUTES les paires `clé: "valeur"` de chaque ligne indentée.
const parseKeys = (block) => {
  const keys = [];
  for (const line of block.split(/\r?\n/)) {
    if (!/^\s{2,}\w+:/.test(line)) continue;
    for (const m of line.matchAll(/(\w+):\s*"[^"]*"/g)) keys.push(m[1]);
  }
  return keys;
};

// Le nom du domaine regroupe les fichiers scindés : `adminEn.ts` + `adminFr.ts`
// portent le MÊME domaine (`admin`), le baril `admin.ts` n'en porte aucun.
const domainOf = (file) => file.replace(/(En|Fr)?\.ts$/, '');

const enKeys = new Set();
const frKeys = new Set();
/** Par domaine, les clés DANS L'ORDRE du fichier (en et fr séparément). */
const byDomain = new Map();
const own = (map, key, domain) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(domain);
};
/** Clé → domaines qui la définissent (une clé dans 2 domaines est écrasée). */
const enOwners = new Map();
const frOwners = new Map();

for (const file of fs.readdirSync(DOMAINS_DIR).filter((f) => f.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(DOMAINS_DIR, file), 'utf8');
  const enBlock = src.match(/export const en = \{([\s\S]*?)\r?\n\};/);
  const frBlock = src.match(/export const fr = \{([\s\S]*?)\r?\n\};/);
  const domain = domainOf(file);
  if (!byDomain.has(domain)) byDomain.set(domain, { en: [], fr: [] });
  const slot = byDomain.get(domain);
  if (enBlock) {
    for (const k of parseKeys(enBlock[1])) {
      enKeys.add(k);
      slot.en.push(k);
      own(enOwners, k, domain);
    }
  }
  if (frBlock) {
    for (const k of parseKeys(frBlock[1])) {
      frKeys.add(k);
      slot.fr.push(k);
      own(frOwners, k, domain);
    }
  }
}

// Usages non-i18n connus : `t` est une variable locale (pas la traduction) dans
// des callbacks comme `arr.filter(t => t.id === ...)`, et ces clés ne sont jamais
// des clés de traduction.
const NON_I18N_KEYS = new Set(['id', 'type']);

// PDF generators and the domain hooks that draw PDF text must ALSO use the
// central dictionary — same parity gate as the UI (reçus, bordereaux,
// rapports follow the chosen language from this single place).
const files = [
  'src/App.tsx',
  ...fs.readdirSync('src/components').filter(f => f.endsWith('.tsx')).map(f => `src/components/${f}`),
  'src/lib/pdfReceipt.ts',
  'src/lib/pdfPayroll.ts',
  'src/lib/pdfPayrollBulletin.ts',
  'src/lib/pdfPayrollDraft.ts',
  'src/lib/pdfExpensesReport.ts',
  'src/lib/pdfFinancialReport.ts',
  'src/lib/pdfAuditJournal.ts',
  'src/lib/pdfMultiYearReport.ts',
  'src/lib/pdfPaymentHistory.ts',
  'src/lib/pdfDailyCashReport.ts',
  'src/app/useParents.ts',
  'src/app/usePayroll.ts',
];

if (scanningRealTree) {
  const missing = new Map(); // key -> [files]
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    // t.<ident> — mais pas t.<ident>( (fonctions) et pas dans les commentaires
    const re = /\bt\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const key = m[1];
      // ignorer les usages non-i18n (ex: t.id, t.type dans ToastNotification —
      // variable locale `t` dans des callbacks type `t => t.id`)
      if (NON_I18N_KEYS.has(key)) continue;
      if (!enKeys.has(key) || !frKeys.has(key)) {
        if (!missing.has(key)) missing.set(key, new Set());
        missing.get(key).add(path.basename(f));
      }
    }
  }

  if (missing.size === 0) {
    console.log(`✅ Toutes les clés t.* référencées existent dans en + fr (${enKeys.size} clés).`);
  } else {
    console.log(`❌ ${missing.size} clés manquantes ou déséquilibrées :`);
    for (const [k, files] of [...missing.entries()].sort()) {
      console.log(`  ${k}  [${[...files].join(',')}]`);
    }
    process.exitCode = 1;
  }
}

// Vérifier aussi la parité stricte
const onlyEn = [...enKeys].filter(k => !frKeys.has(k));
const onlyFr = [...frKeys].filter(k => !enKeys.has(k));
if (onlyEn.length || onlyFr.length) {
  console.log(`\n⚠️ Déséquilibre : ${onlyEn.length} seulement en, ${onlyFr.length} seulement fr`);
  console.log('  en:', onlyEn.slice(0, 10).join(', '));
  console.log('  fr:', onlyFr.slice(0, 10).join(', '));
  process.exitCode = 1;
}

// ─── Ordre des clés : en et fr doivent se lire dans le MÊME ordre ───────────
// Le baril fusionne les domaines dans un ordre fixe ; si l'ordre interne d'un
// domaine divergeait entre les deux langues, les deux dictionnaires
// n'auraient plus la même disposition — et un diff clavier deviendrait illisible.
const orderIssues = [];
for (const [domain, { en, fr }] of byDomain) {
  const frSet = new Set(fr);
  const enSet = new Set(en);
  const enCommon = en.filter((k) => frSet.has(k));
  const frCommon = fr.filter((k) => enSet.has(k));
  for (let i = 0; i < Math.max(enCommon.length, frCommon.length); i += 1) {
    if (enCommon[i] !== frCommon[i]) {
      orderIssues.push(`${domain} #${i} : en=${enCommon[i] ?? '—'} / fr=${frCommon[i] ?? '—'}`);
    }
  }
}

// ─── Doublons ENTRE domaines : le spread du baril écrase silencieusement la
//     définition du domaine fusionné en premier (ex. common … puis admin). ──
const duplicates = [];
for (const [label, owners] of [['en', enOwners], ['fr', frOwners]]) {
  for (const [key, domains] of owners) {
    if (domains.size > 1) duplicates.push(`${label}: ${key} → ${[...domains].join(' , ')}`);
  }
}

// Anti-vacuité : un scan qui ne lit AUCUN domaine n'est pas un vert.
if (byDomain.size === 0) {
  console.log('❌ Rien à vérifier : aucun domaine i18n lu — un scan vide n’est pas un vert.');
  process.exitCode = 1;
} else if (orderIssues.length === 0 && duplicates.length === 0) {
  console.log(`\n✅ Ordre des clés identique en/fr dans chaque domaine, aucun doublon entre domaines (${byDomain.size} domaines).`);
} else {
  if (orderIssues.length) {
    console.log(`\n❌ Ordre des clés divergent entre en et fr (${orderIssues.length}) :`);
    for (const x of orderIssues.slice(0, 20)) console.log(`  ${x}`);
  }
  if (duplicates.length) {
    console.log(`❌ Clé(s) définie(s) dans PLUSIEURS domaines — la dernière écrase silencieusement (${duplicates.length}) :`);
    for (const x of duplicates) console.log(`  ${x}`);
  }
  process.exitCode = 1;
}