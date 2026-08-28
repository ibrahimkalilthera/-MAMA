// Guard: every prop declared in a component's props interface must be passed
// where the component is rendered in App.tsx. Prevents the partial-wiring bug
// where lazy components silently received undefined props (tsc does not check
// props of lazy() components). Exits 1 on any mismatch.
import { readFileSync } from 'node:fs';

const APP = 'src/App.tsx';
// Components rendered directly from App.tsx with an explicit props interface.
const COMPONENTS = ['MainViews', 'AppModals', 'ArchivesView'];

const app = readFileSync(APP, 'utf8').replace(/\r\n/g, '\n'); // CRLF-tolerant

const extractProps = (file, name) => {
  const src = readFileSync(file, 'utf8');
  const m = src.match(new RegExp(`export interface ${name}Props \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`interface ${name}Props introuvable dans ${file}`);
  return [...m[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((x) => x[1]);
};

const extractPassed = (name) => {
  const start = app.indexOf(`<${name}\n`);
  if (start < 0) {
    const inline = app.indexOf(`<${name} `);
    if (inline < 0) throw new Error(`rendu de <${name}> introuvable dans ${APP}`);
    const close = app.indexOf('/>', inline);
    const tag = app.slice(inline, close);
    return [...tag.matchAll(/([A-Za-z0-9_]+)=\{/g)].map((x) => x[1]);
  }
  const close = app.indexOf('/>', start);
  if (close < 0) throw new Error(`fermeture du tag <${name}> introuvable`);
  const tag = app.slice(start, close);
  return [...tag.matchAll(/^\s*([A-Za-z0-9_]+)=\{/gm)].map((x) => x[1]);
};

let ok = true;
for (const name of COMPONENTS) {
  const file = `src/components/${name}.tsx`;
  const declared = extractProps(file, name);
  const passed = extractPassed(name);
  const missing = declared.filter((p) => !passed.includes(p));
  const extra = passed.filter((p) => !declared.includes(p));
  if (missing.length || extra.length) {
    ok = false;
    console.error(`❌ ${name}: ${declared.length} props déclarées, ${passed.length} passées`);
    if (missing.length) console.error(`   manquantes (${missing.length}): ${missing.join(', ')}`);
    if (extra.length) console.error(`   non déclarées (${extra.length}): ${extra.join(', ')}`);
  } else {
    console.log(`✅ ${name}: ${declared.length}/${passed.length} props — câblage complet`);
  }
}

if (!ok) {
  console.error('\nCâblage partiel détecté — corrigez avant de committer (voir le bug de la page blanche).');
  process.exit(1);
}
console.log('\nTous les câblages sont complets.');
