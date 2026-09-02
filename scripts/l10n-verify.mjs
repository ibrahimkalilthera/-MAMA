// Vérifier que toutes les références t.<key> dans les composants existent dans le dictionnaire (en + fr)
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync('src/i18n/translations.ts', 'utf8');
const enBlock = src.match(/en: \{([\s\S]*?)\r?\n  \},\r?\n  fr: \{/)[1];
const frBlock = src.match(/fr: \{([\s\S]*?)\r?\n  \},?\r?\n\};/)[1];
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
const enKeys = new Set(parseKeys(enBlock));
const frKeys = new Set(parseKeys(frBlock));

// Usages non-i18n connus : `t` est une variable locale (pas la traduction) dans
// des callbacks comme `arr.filter(t => t.id === ...)`, et ces clés ne sont jamais
// des clés de traduction.
const NON_I18N_KEYS = new Set(['id', 'type']);

const files = ['src/App.tsx', ...fs.readdirSync('src/components').filter(f => f.endsWith('.tsx')).map(f => `src/components/${f}`)];

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
  console.log('✅ Toutes les clés t.* référencées existent dans en + fr.');
} else {
  console.log(`❌ ${missing.size} clés manquantes ou déséquilibrées :`);
  for (const [k, files] of [...missing.entries()].sort()) {
    console.log(`  ${k}  [${[...files].join(',')}]`);
  }
  process.exitCode = 1;
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