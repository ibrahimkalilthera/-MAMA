// Vérifier que toutes les références t.<key> dans les composants existent dans le dictionnaire (en + fr)
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync('src/App.tsx', 'utf8');
const enBlock = src.match(/en: \{([\s\S]*?)\r?\n  \},\r?\n  fr: \{/)[1];
const frBlock = src.match(/fr: \{([\s\S]*?)\r?\n  \}\r?\n\};/)[1];
const parseKeys = (block) => [...block.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
const enKeys = new Set(parseKeys(enBlock));
const frKeys = new Set(parseKeys(frBlock));

const files = ['src/App.tsx', ...fs.readdirSync('src/components').filter(f => f.endsWith('.tsx')).map(f => `src/components/${f}`)];

const missing = new Map(); // key -> [files]
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  // t.<ident> — mais pas t.<ident>( (fonctions) et pas dans les commentaires
  const re = /\bt\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = m[1];
    // ignorer les usages non-i18n (ex: t.id, t.type dans ToastNotification)
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
}

// Vérifier aussi la parité stricte
const onlyEn = [...enKeys].filter(k => !frKeys.has(k));
const onlyFr = [...frKeys].filter(k => !enKeys.has(k));
if (onlyEn.length || onlyFr.length) {
  console.log(`\n⚠️ Déséquilibre : ${onlyEn.length} seulement en, ${onlyFr.length} seulement fr`);
  console.log('  en:', onlyEn.slice(0, 10).join(', '));
  console.log('  fr:', onlyFr.slice(0, 10).join(', '));
}