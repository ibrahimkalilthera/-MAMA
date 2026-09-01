// Guard: every required prop declared in a component's props interface must be
// passed where the component is rendered. Prevents the partial-wiring bug where
// lazy components silently received undefined props (tsc does not check props
// of lazy() components). Exits 1 on any mismatch.
import { readFileSync } from 'node:fs';

// name: component; file: where its props interface lives; render: where it is rendered
const COMPONENTS = [
  // MainViews' props contract lives in its dedicated types module — the single
  // source of truth (see src/app/mainViewsProps.ts + tests/mainviews-props.test.ts).
  { name: 'MainViews', file: 'src/app/mainViewsProps.ts', render: 'src/App.tsx' },
  { name: 'AppModals', file: 'src/components/AppModals.tsx', render: 'src/App.tsx' },
  { name: 'ArchivesView', file: 'src/components/ArchivesView.tsx', render: 'src/App.tsx' },
  { name: 'PromotionWizardModal', file: 'src/components/PromotionWizardModal.tsx', render: 'src/App.tsx' },
  { name: 'DashboardCharts', file: 'src/components/DashboardCharts.tsx', render: 'src/components/DashboardView.tsx' },
  { name: 'MultiYearChart', file: 'src/components/MultiYearChart.tsx', render: 'src/components/ArchivesView.tsx' },
];

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); // CRLF-tolerant

// Top-level props of <name>Props (exported or not). Returns { required, all }.
const extractProps = (file, name) => {
  const src = read(file);
  const m = src.match(new RegExp(`(?:export )?interface ${name}Props \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`interface ${name}Props introuvable dans ${file}`);
  const entries = [...m[1].matchAll(/^\s{2}([A-Za-z0-9_]+)(\?)?:/gm)];
  return {
    required: entries.filter((x) => !x[2]).map((x) => x[1]),
    all: entries.map((x) => x[1]),
  };
};

// Resolve an object-literal spread used at the render site: <Name {...viewsProps} />
// becomes the keys of the `const viewsProps: … = { … }` literal in the same file,
// so the guard keeps verifying the full wiring even when the JSX is a spread.
const resolveSpreadLiteral = (src, spreadName) => {
  const m = src.match(new RegExp(`const ${spreadName}\\s*:\\s*[^=]+=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!m) throw new Error(`objet-littéral \`${spreadName}\` introuvable dans le fichier de rendu`);
  return [...m[1].matchAll(/^\s{2}([A-Za-z0-9_]+),/gm)].map((x) => x[1]);
};

// Attribute names passed at the render site: explicit props plus any resolved
// object-literal spreads ({...viewsProps}). Returns { passed, hasSpread } —
// hasSpread tells the caller that the site relies on a typed object literal
// (whose keys tsc verifies against the intersection type), so the `extra` check
// is intentionally skipped there: a shared object like viewsProps carries BOTH
// shell contracts, and its superset keys are by design.
const extractPassed = (render, name) => {
  const src = read(render);
  const start = src.indexOf(`<${name}\n`);
  const inline = start < 0 ? src.indexOf(`<${name} `) : -1;
  const from = start >= 0 ? start : inline;
  if (from < 0) throw new Error(`rendu de <${name}> introuvable dans ${render}`);
  const close = src.indexOf('/>', from);
  if (close < 0) throw new Error(`fermeture du tag <${name}> introuvable dans ${render}`);
  const tag = src.slice(from, close);
  const passed = [...tag.matchAll(/([A-Za-z0-9_]+)=\{/g)].map((x) => x[1]);
  const spreads = [...tag.matchAll(/\{\.\.\.([A-Za-z0-9_]+)\}/g)];
  for (const spread of spreads) {
    passed.push(...resolveSpreadLiteral(src, spread[1]));
  }
  return { passed, hasSpread: spreads.length > 0 };
};

let ok = true;
for (const { name, file, render } of COMPONENTS) {
  const { required, all } = extractProps(file, name);
  const { passed, hasSpread } = extractPassed(render, name);
  const missing = required.filter((p) => !passed.includes(p));
  const extra = hasSpread ? [] : passed.filter((p) => !all.includes(p));
  if (missing.length || extra.length) {
    ok = false;
    console.error(`❌ ${name}: ${required.length} props requises, ${passed.length} passées`);
    if (missing.length) console.error(`   manquantes (${missing.length}): ${missing.join(', ')}`);
    if (extra.length) console.error(`   non déclarées (${extra.length}): ${extra.join(', ')}`);
  } else {
    console.log(`✅ ${name}: ${required.length}/${required.length} props requises — câblage complet`);
  }
}

if (!ok) {
  console.error('\nCâblage partiel détecté — corrigez avant de committer (voir le bug de la page blanche).');
  process.exit(1);
}
console.log('\nTous les câblages sont complets.');
